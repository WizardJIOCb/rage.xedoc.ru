const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Game state
let users = {}; // { username: { hp, rating, deadUntil, socketId } }
let messages = []; // recent messages
const MAX_MESSAGES = 80;

// Russian + some English swears
const SWEAR_WORDS = [
  'бля', 'блядь', 'блядина', 'сука', 'сучка', 'пизд', 'пиздец', 'пизда',
  'хуй', 'хуя', 'хули', 'нахуй', 'похуй', 'еб', 'ебан', 'ебать', 'ебаный',
  'ебало', 'уеб', 'уёб', 'гандон', 'мудак', 'мудила', 'дебил', 'идиот',
  'тупой', 'тупая', 'лошара', 'чмо', 'чмошник', 'пидар', 'пидор', 'пидр',
  'шлюха', 'шлюх', 'курва', 'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dick'
];

function containsSwear(text) {
  const lower = text.toLowerCase();
  return SWEAR_WORDS.some(word => lower.includes(word));
}

function extractMentions(text) {
  const regex = /@([A-Za-z0-9_\u0400-\u04FF]{2,20})/g;
  const mentions = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    mentions.push(match[1]);
  }
  return [...new Set(mentions)];
}

function getPublicUserList() {
  return Object.entries(users).map(([username, data]) => ({
    username,
    hp: data.hp,
    rating: data.rating,
    deadUntil: data.deadUntil,
    isDead: data.deadUntil > Date.now()
  }));
}

function broadcastUserList() {
  io.emit('userList', getPublicUserList());
}

function addMessage(msg) {
  messages.push(msg);
  if (messages.length > MAX_MESSAGES) messages.shift();
  io.emit('newMessage', msg);
}

function reviveDeadUsers() {
  let changed = false;
  const now = Date.now();
  for (const [name, data] of Object.entries(users)) {
    if (data.deadUntil > 0 && now > data.deadUntil) {
      data.hp = 100;
      data.deadUntil = 0;
      changed = true;
      addMessage({
        type: 'system',
        text: `💚 ${name} воскрес!`,
        timestamp: Date.now()
      });
    }
  }
  if (changed) broadcastUserList();
}

// Check revives every second
setInterval(reviveDeadUsers, 1000);

// BOT SYSTEM for solo fun
const BOT_NAMES = ['Громила', 'Злая_Сука', 'Тролль_2000', 'Кровавый_Рот', 'Мясник'];
const BOT_INSULTS = [
  '@%target% ты %swear%!',
  'Эй @%target%, иди %swear% отсюда',
  '@%target% %swear% ты полный',
  'Слышь @%target% ты %swear% конченный',
  '@%target% %swear%, закрой рот',
  'Пошёл нахуй @%target% %swear%',
  '@%target% ты %swear% %swear%'
];
const SWEAR_PARTS = ['сука', 'блядина', 'пиздец', 'еблан', 'мудак', 'чмо', 'дегенерат', 'лошара'];

let botsActive = false;

function activateBots() {
  if (botsActive) return;
  botsActive = true;

  // Add bots to users
  BOT_NAMES.forEach((bot, i) => {
    if (!users[bot]) {
      users[bot] = {
        hp: 100,
        rating: 800 + i * 50,
        deadUntil: 0,
        socketId: null,
        isBot: true
      };
    }
  });
  broadcastUserList();

  // Bot action loop
  setInterval(() => {
    const aliveBots = BOT_NAMES.filter(n => users[n] && users[n].deadUntil === 0);
    const aliveHumans = Object.keys(users).filter(n => !users[n].isBot && users[n].deadUntil === 0);

    if (aliveBots.length === 0) return;

    const bot = aliveBots[Math.floor(Math.random() * aliveBots.length)];
    const possibleTargets = [...aliveHumans, ...BOT_NAMES.filter(n => n !== bot && users[n] && users[n].deadUntil === 0)];

    if (possibleTargets.length === 0) return;

    const target = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];

    // 65% chance to insult, 35% normal chat
    if (Math.random() < 0.65) {
      const template = BOT_INSULTS[Math.floor(Math.random() * BOT_INSULTS.length)];
      const swear = SWEAR_PARTS[Math.floor(Math.random() * SWEAR_PARTS.length)];
      const insult = template.replace('%target%', target).replace(/%swear%/g, swear);

      processMessage(bot, insult, true);
    } else {
      const normals = [
        'всем привет', 'как дела?', 'кто тут живой?', 'лол', 'агааа', 'хаха'
      ];
      addMessage({
        type: 'chat',
        sender: bot,
        text: normals[Math.floor(Math.random() * normals.length)],
        timestamp: Date.now()
      });
    }
  }, 9500 + Math.random() * 5000);
}

function processMessage(sender, text, isBot = false) {
  const user = users[sender];
  if (!user) return;

  const now = Date.now();
  if (user.deadUntil > 0 && user.deadUntil > now) {
    // Silenced user or bot can't speak
    if (!isBot) {
      io.to(user.socketId).emit('silenced', Math.ceil((user.deadUntil - now) / 1000));
    }
    return;
  }

  // Always send the chat message
  const chatMsg = {
    type: 'chat',
    sender,
    text,
    timestamp: now
  };
  addMessage(chatMsg);

  // Check for attack
  if (!containsSwear(text)) return;

  const mentions = extractMentions(text);
  if (mentions.length === 0) return;

  let damageDealt = false;

  for (const rawTarget of mentions) {
    // Find exact username match (case-insensitive lookup)
    let target = null;
    for (const name of Object.keys(users)) {
      if (name.toLowerCase() === rawTarget.toLowerCase()) {
        target = name;
        break;
      }
    }
    if (!target || target === sender) continue;

    const targetUser = users[target];
    if (!targetUser || targetUser.deadUntil > now) continue;

    const damage = Math.floor(Math.random() * 29) + 14; // 14-42 dmg
    targetUser.hp = Math.max(0, targetUser.hp - damage);

    // Attacker gets rating boost
    if (!user.isBot) {
      user.rating = (user.rating || 1000) + 9;
    }

    damageDealt = true;

    // Attack event
    io.emit('attack', {
      attacker: sender,
      target,
      damage,
      timestamp: now
    });

    // Check for death
    if (targetUser.hp <= 0 && targetUser.deadUntil === 0) {
      targetUser.deadUntil = now + 60000;
      targetUser.rating = Math.max(50, (targetUser.rating || 1000) - 55);

      addMessage({
        type: 'death',
        text: `☠️ ${target} УМЕР от рук ${sender}! Снижен рейтинг и молчание 60 сек`,
        timestamp: now
      });

      // Extra reward for killer
      if (!user.isBot) {
        user.rating = (user.rating || 1000) + 35;
      }
    }
  }

  if (damageDealt) {
    broadcastUserList();
  }
}

// Socket handling
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  socket.on('join', (username) => {
    if (!username || typeof username !== 'string') return;

    username = username.trim().slice(0, 18);

    if (username.length < 2) {
      socket.emit('joinError', 'Имя слишком короткое');
      return;
    }

    // Check if taken
    const taken = Object.keys(users).some(u => u.toLowerCase() === username.toLowerCase());
    if (taken) {
      socket.emit('joinError', 'Это имя уже занято');
      return;
    }

    users[username] = {
      hp: 100,
      rating: 1000,
      deadUntil: 0,
      socketId: socket.id,
      isBot: false
    };

    socket.username = username;
    socket.emit('joined', { username });

    // Send recent history
    socket.emit('messageHistory', messages);

    // Send current users
    socket.emit('userList', getPublicUserList());

    addMessage({
      type: 'system',
      text: `👋 ${username} присоединился к арене`,
      timestamp: Date.now()
    });

    broadcastUserList();

    // Activate bots on first real player
    const realPlayers = Object.keys(users).filter(u => !users[u].isBot);
    if (realPlayers.length === 1) {
      activateBots();
    }
  });

  socket.on('chatMessage', ({ message }) => {
    if (!socket.username || !message || typeof message !== 'string') return;
    const trimmed = message.trim();
    if (!trimmed || trimmed.length > 280) return;

    processMessage(socket.username, trimmed);
  });

  socket.on('quickRoast', ({ target }) => {
    if (!socket.username || !target || !users[target]) return;
    const user = users[socket.username];
    if (!user || user.deadUntil > Date.now()) return;

    const swears = ['сука', 'блядина', 'пиздец', 'еблан', 'мудак'];
    const roast = `@${target} ты ${swears[Math.floor(Math.random() * swears.length)]}!`;
    processMessage(socket.username, roast);
  });

  socket.on('disconnect', () => {
    if (socket.username && users[socket.username]) {
      const name = socket.username;
      // Remove the human player from list
      delete users[name];

      addMessage({
        type: 'system',
        text: `👋 ${name} покинул арену`,
        timestamp: Date.now()
      });
      broadcastUserList();
    }
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🔥 RAGE ARENA running on http://localhost:${PORT}`);
  console.log('Join with different names in multiple tabs for max fun!');
});