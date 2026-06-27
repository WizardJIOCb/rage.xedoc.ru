const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Fallback to serve socket.io client if the library's handler doesn't catch it (helps behind some proxies)
app.get('/socket.io/socket.io.js', (req, res) => {
  const clientFile = path.join(__dirname, 'node_modules', 'socket.io', 'client-dist', 'socket.io.js');
  if (require('fs').existsSync(clientFile)) {
    res.sendFile(clientFile);
  } else {
    res.status(404).send('socket.io client not found');
  }
});

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
  'шлюха', 'шлюх', 'курва', 'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dick',
  'хуйло', 'пиздюл', 'долбоеб', 'мудозв', 'пидарас', 'ебло', 'хуепу', 'пиздабол'
];

function containsSwear(text) {
  const lower = text.toLowerCase();
  return SWEAR_WORDS.some(word => lower.includes(word));
}

function extractMentions(text) {
  // More robust: capture name, consume trailing punctuation like "!" immediately after name
  const regex = /@([A-Za-z0-9_\u0400-\u04FF]{2,20})[!?,.;:\s]*/g;
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

// Крутые, разнообразные, АХУЕННО весёлые оскорбления
// Сейчас 58+ штук — комбинаций с матами уже десятки тысяч
const BOT_INSULTS = [
  '@%target% ты %swear% позорная, даже твоя тень от тебя отворачивается!',
  'Эй @%target%, ты %swear%, иди отсюда пока я не начал ржать над тобой в голос',
  '@%target% %swear% ты полный, у тебя в голове только свист и ветер',
  'Слышь @%target%, ты %swear% конченный или просто стараешься изо всех сил?',
  '@%target% %swear%, закрой свой поганый рот, здесь и без тебя воняет отчаянием',
  'Пошёл нахуй @%target% %swear%, твоё лицо — это ошибка природы и плохого освещения',
  '@%target% ты %swear% %swear%, я в шоке, как тебя мама вообще выпустила из дома',
  '@%target% %swear%, я тебя сейчас морально разъебу так, что ты в себя не придёшь',
  'Бля @%target% ты %swear% ебаный, твой рейтинг плачет кровавыми слезами',
  '@%target% иди нахуй со своим %swear% лицом, оно портит мне весь вайб арены',
  'Слышь @%target%, ты %swear% или у меня просто от тебя глаза кровоточат?',
  '@%target% %swear%, мать твою и весь твой жалкий родословный пиздец',
  'Ахах @%target% ты %swear% жалкий, даже боты от тебя в депрессии уходят',
  '@%target% закрой свою %swear% пасть, пока я не начал цитировать твои грехи',
  'Пиздец @%target%, ты реально %swear%, и это ещё самая вежливая версия',
  '@%target% %swear%, даже в аду тебя пошлют обратно как слишком токсичного',
  'Эй @%target%, иди %swear% в свою нору, там тебе и место среди таких же неудачников',
  '@%target% ты %swear%, иди умойся... а лучше просто исчезни из этого чата',
  'Блядина @%target% %swear% ты, у тебя мозг как у курицы, только злее и глупее',
  '@%target% ты не просто %swear%, ты целый набор %swear% с бесплатной доставкой',
  'Слышь @%target% %swear%, твои родители точно проиграли в генетическую лотерею',
  '@%target%, %swear%, иди полежи, пока я не начал тебя добивать словами',
  'Ахахаха @%target% ты %swear% уровня бог, только боги давно умерли от стыда',
  '@%target% %swear%, твой стиль — это как если бы пиздец решил стать человеком',
  'Бля @%target%, ты %swear%, и я это говорю с любовью... нет, с чистой ненавистью',
  '@%target% ты %swear% %swear%, я уже вижу как твой рейтинг падает в бездну',
  '@%target% ты %swear%, я бы тебя даже на помойке не подобрал — слишком воняет безысходностью',
  'Слышь @%target%, ты %swear% %swear%, твоя мама в чате просила тебя не позорить',
  '@%target% %swear%, я тебя сейчас так опущу, что даже твой рейтинг покраснеет',
  'Ахах @%target%, ты %swear%, иди лечись, у тебя уже терминальная стадия уёбства',
  '@%target% ты не %swear%, ты целый фестиваль %swear% с бесплатным входом',
  'Эй @%target%, закрой свою %swear% пасть, здесь пахнет твоим отчаянием и старыми носками',
  'Пиздец @%target%, ты %swear%, даже нейросеть отказалась генерировать тебя красиво',
  '@%target% %swear%, я бы тебя задушил, но боюсь, что ты мне руки потом обосрёшь',
  'Бля @%target%, ты %swear% с привкусом трагедии и дешёвого пива',
  '@%target% ты %swear%, иди домой, твоя кошка уже стыдится, что живёт с тобой',
  'Слышь @%target% %swear%, у тебя такой талант — быть полным уёбком без усилий',
  '@%target%, %swear%, я смотрю на тебя и понимаю, почему инопланетяне не хотят с нами контактировать',
  'Ахах @%target% ты %swear%, даже твоя тень пытается от тебя отвалиться',
  '@%target% %swear%, ты такой %swear%, что когда ты заходишь в комнату — батарейки садятся',
  'Пошёл нахуй @%target% %swear%, ты позоришь даже слово "позор"',
  '@%target% ты %swear%, я бы тебя забанил, но ты слишком забавный в своём уёбстве',
  'Блядина @%target%, ты %swear%, у тебя в голове wifi только для рекламы дешёвых матов',
  '@%target% %swear%, иди полежи, ты уже источаешь токсичность на молекулярном уровне',
  'Слышь @%target%, ты %swear% %swear%, даже твой ник воняет отчаянием',
  '@%target% ты %swear%, я тебя сейчас морально уничтожу так, что потом будешь молиться на мой рейтинг',
  'Эй @%target% %swear%, ты не человек, ты ошибка в матрице с премиум-аккаунтом',
  '@%target% %swear%, я смотрю на тебя и думаю "как тебя вообще пустили в этот чат"',
  'Бля @%target%, ты %swear%, у тебя такой талант разочаровывать всех вокруг',
  '@%target% ты %swear%, даже твой ник просит прощения у всех, кто его видит',
  'Слышь @%target% %swear%, ты такой уёбок, что даже когда молчишь — все страдают',
  '@%target%, %swear%, я бы тебя вылечил, но медицина бессильна перед таким уровнем',
  'Ахах @%target% ты %swear%, когда ты пишешь — даже эмодзи плачут',
  '@%target% %swear%, ты не просто токсичный, ты радиоактивный',
  '@%target% %swear%, ты — живое доказательство, что эволюция иногда ошибается',
  'Бля @%target%, %swear%, когда ты пишешь — я слышу звук падающего IQ в чате',
  '@%target% ты %swear%, я бы тебя похвалил, но боюсь, что ты подумаешь, будто я серьёзно'
];

const SWEAR_PARTS = [
  'сука', 'блядина', 'пиздец', 'еблан', 'мудак', 'чмо', 'дегенерат', 'лошара',
  'пидор', 'хуесос', 'ебанат', 'кретин', 'тупой', 'ублюдок', 'гнида', 'мразь',
  'шлюха', 'конченый', 'долбоеб', 'идиот', 'дебил', 'мудило', 'хуйло', 'пиздюлина',
  'долбоящер', 'еблоёбина', 'гандон', 'мудозвон', 'пидарас', 'шлюхоблядь',
  'пиздабол', 'хуепутало', 'дебилюга', 'сука позорная', 'мразота', 'гнильё',
  'вонючий', 'сраный', 'недоёбок', 'блядун', 'пиздец полный', 'тварь позорная',
  'пиздострадалец', 'еблофил', 'мудак с дипломом', 'сука-недоразумение',
  'гандон вселенский', 'пиздец в человеческом обличии', 'дегенерат премиум',
  'хуй в кармане', 'мудила экстра', 'блядун-неудачник', 'ебаный в рот без смазки',
  'тупой как пробка', 'гнида с характером', 'шлюха-недоделок', 'конченый проект',
  'пиздюк без таланта', 'еблан-виртуоз', 'мразь высшей пробы',
  'сука-терминатор', 'ебло-монстр', 'пиздец-артист', 'мудак-олимпиец',
  'гандон-визионер', 'дегенерат-легенда', 'хуйло-чемпион'
];

// Смертоносные, жёсткие и АХУЕННО смешные таунты (когда цель уже почти труп)
const BOT_TAUNTS = [
  'ахах @%target% сдох как %swear%, красиво лежишь, урод',
  '@%target% даже твои предки в аду от тебя стыдятся, %swear%',
  'ну и %swear% же ты @%target%, просто легенда... позора',
  '@%target% иди полежи %swear%, ты уже не жилец в этом чате',
  'лол @%target% ты %swear%, умер как настоящий воин... воин пиздеца',
  '@%target%, %swear%, твой труп красивее чем ты при жизни был',
  'ахахах @%target% сдох %swear%, я даже не успел нормально над тобой поиздеваться',
  '@%target% %swear%, возвращайся через 60 секунд, я ещё не наговорился',
  'бля @%target% ты %swear%, даже смерть от тебя устала',
  '@%target% сдох как %swear%, респект... нет, никакого респекта',
  'пиздец @%target%, ты %swear%, даже на том свете будешь всех бесить',
  '@%target% %swear%, твоя смерть — это лучшее, что ты сделал за всю жизнь',
  'ахах @%target%, ты %swear%, умираешь красиво... как и жил — уёбски',
  '@%target% сдох как %swear%, я бы даже надгробие не поставил — жалко камня',
  'лол @%target% %swear%, даже черти в аду сказали "бля, опять этот"',
  '@%target%, %swear%, возвращайся через минуту, мне ещё есть что сказать',
  'Бля @%target% ты %swear%, твоя смерть была такой же унылой, как и ты',
  '@%target% сдох %swear%, даже твой ник теперь выглядит лучше без тебя',
  'пиздец @%target%, ты %swear%, даже твоя смерть была разочарованием',
  '@%target% %swear%, умираешь как жил — громко и бесполезно',
  'ахах @%target% %swear%, твоя смерть — лучшее, что случилось с этим чатом за сегодня',
  '@%target%, %swear%, даже на том свете ты будешь всех бесить своим присутствием'
];

let botsActive = false;
let botsPaused = false;

function ensureBotEntry(name) {
  if (users[name] && users[name].isBot) return users[name];
  // Only create for known bot names (or allow new via addBot)
  if (!BOT_NAMES.includes(name)) return null;

  users[name] = {
    hp: 100,
    rating: 700 + Math.floor(Math.random() * 300),
    deadUntil: 0,
    socketId: null,
    isBot: true,
    active: true
  };
  return users[name];
}

function activateBots() {
  if (botsActive) return;
  botsActive = true;

  // Add bots to users (with active flag)
  BOT_NAMES.forEach((bot, i) => {
    if (!users[bot]) {
      users[bot] = {
        hp: 100,
        rating: 800 + i * 50,
        deadUntil: 0,
        socketId: null,
        isBot: true,
        active: true
      };
    } else {
      users[bot].active = true;
    }
  });
  broadcastUserList();

  // Bot action loop
  setInterval(() => {
    if (botsPaused) return;

    const aliveBots = BOT_NAMES.filter(n => 
      users[n] && 
      users[n].active !== false && 
      users[n].deadUntil === 0
    );
    const aliveHumans = Object.keys(users).filter(n => !users[n].isBot && users[n].deadUntil === 0);

    if (aliveBots.length === 0) return;

    const bot = aliveBots[Math.floor(Math.random() * aliveBots.length)];
    const possibleTargets = [...aliveHumans, ...BOT_NAMES.filter(n => n !== bot && users[n] && users[n].deadUntil === 0)];

    if (possibleTargets.length === 0) return;

    const target = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];

    const rand = Math.random();

    if (rand < 0.55) {
      // Normal insult
      const template = BOT_INSULTS[Math.floor(Math.random() * BOT_INSULTS.length)];
      const swear = SWEAR_PARTS[Math.floor(Math.random() * SWEAR_PARTS.length)];
      const insult = template.replace('%target%', target).replace(/%swear%/g, swear);
      processMessage(bot, insult, true);
    } else if (rand < 0.75 && BOT_TAUNTS.length > 0) {
      // Taunt
      const template = BOT_TAUNTS[Math.floor(Math.random() * BOT_TAUNTS.length)];
      const swear = SWEAR_PARTS[Math.floor(Math.random() * SWEAR_PARTS.length)];
      const taunt = template.replace('%target%', target).replace(/%swear%/g, swear);
      processMessage(bot, taunt, true);
    } else {
      // Normal chat or funny lines — теперь с характером и душой
      const normals = [
        'всем привет, я пришёл вас морально уничтожать',
        'как дела, %swear%ы? а впрочем похуй',
        'кто тут живой? я вижу только %swear%ов и трупы',
        'лол, опять этот чат превратился в помойку',
        'агааа, сегодня я особенно токсичный, держитесь',
        'хахаха кто-нибудь видел как этот урод сдох только что?',
        'ну и денёк... опять все вокруг %swear%ы какие-то',
        'я вас всех порву, а потом ещё и морально',
        'кто последний сдох? давайте сделаем это снова',
        'тишина в чате пиздец, как будто все уже умерли',
        'бля, я тут самый адекватный, а это страшно',
        'ребят, давайте без мата... ахах нет, я шучу, ебите друг друга',
        'кто-нибудь видел мой мозг? я его потерял когда увидел этого уёбка',
        'сегодня я в настроении быть полным %swear%ом, извините',
        'пиздец, тут такой уровень токсичности, я в раю',
        'я не бот, я просто очень злая программа с характером',
        'кто хочет бесплатный буст в виде -30 хп? спрашивайте меня',
        'тишина... это перед бурей из %swear%ов и матов',
        'бля, я только что видел как кто-то умер красиво... нет, врёшь',
        'ребята, а кто-нибудь вообще живой или все уже %swear%ы?',
        'сегодня я в настроении всех морально выебать и потом ещё посмеяться',
        'кто-нибудь видел мой последний мозг? кажется я его оставил в 2019',
        'пиздец, этот чат — как моя бывшая: токсичный и всегда возвращается',
        'лол я только что прочитал чьи-то сообщения и чуть не сдох от смеха',
        'ага, сегодня все такие %swear%ы, я в восторге',
        'кто последний накосячил? давайте сделаем это командой',
        'я не злюсь, я просто очень громко выражаю свою любовь к вам, %swear%ам',
        'тишина... подозрительно... кто-то точно сейчас готовится наебать всех',
        'бля, я тут сижу и думаю: а не пойти ли мне самому нахуй?',
        'кто хочет, чтобы я его сегодня особенно красиво унизил? пишите в личку',
        'сегодня я чувствую себя особенно %swear%ски вдохновлённым',
        'лол, этот чат — лучшее место, чтобы понять, насколько люди могут быть уёбками',
        'кто-нибудь вообще читает что я пишу или все уже в ахуе?',
        'бля, я только что понял — мы все тут %swear%ы, просто в разной степени'
      ];

      let normalText = normals[Math.floor(Math.random() * normals.length)];

      // Вставляем мат иногда
      if (Math.random() < 0.45) {
        const swear = SWEAR_PARTS[Math.floor(Math.random() * SWEAR_PARTS.length)];
        normalText = normalText.replace(/%swear%/g, swear);
      }

      // Вставляем цель, если есть кого упомянуть
      if (Math.random() < 0.35 && possibleTargets.length > 0) {
        const rndTarget = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];
        normalText = normalText.replace(/@?%target%/g, '@' + rndTarget);
      }

      // Убираем оставшиеся плейсхолдеры
      normalText = normalText.replace(/@?%target%/g, '').replace(/%swear%/g, 'пиздец');

      addMessage({
        type: 'chat',
        sender: bot,
        text: normalText,
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

// === Admin bot controls ===
function setBotActive(name, active) {
  let botUser = users[name];
  if (!botUser) {
    botUser = ensureBotEntry(name);
  }
  if (botUser && botUser.isBot) {
    botUser.active = !!active;
    io.emit('admin:botUpdate', { name, active: botUser.active });
    broadcastUserList();
  }
}

function addBot(name) {
  name = (name || '').trim().slice(0, 18);
  if (!name || users[name]) return false;

  users[name] = {
    hp: 100,
    rating: 700 + Math.floor(Math.random() * 300),
    deadUntil: 0,
    socketId: null,
    isBot: true,
    active: true
  };

  if (!BOT_NAMES.includes(name)) {
    BOT_NAMES.push(name);
  }

  broadcastUserList();
  io.emit('admin:botUpdate', { name, active: true, isNew: true });

  if (!botsActive) activateBots();
  return true;
}

function getBotList() {
  // Lazily ensure default bots exist so admin panel can always see and control them
  // even before anyone joins the main chat
  let created = false;
  BOT_NAMES.forEach(n => {
    if (!users[n]) {
      ensureBotEntry(n);
      created = true;
    }
  });
  if (!botsActive && BOT_NAMES.length > 0) {
    activateBots();
  }
  if (created) broadcastUserList();
  return BOT_NAMES.map(n => ({
    name: n,
    active: !!(users[n] && users[n].active !== false),
    hp: users[n] ? users[n].hp : 0
  }));
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

  // === Admin panel controls ===
  socket.on('admin:getBots', () => {
    socket.emit('admin:bots', getBotList());
  });

  socket.on('admin:toggleBot', ({ name, active }) => {
    setBotActive(name, active);
  });

  socket.on('admin:addBot', ({ name }) => {
    addBot(name);
  });

  socket.on('admin:pauseAll', ({ paused }) => {
    botsPaused = !!paused;
    io.emit('admin:botsPaused', botsPaused);
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