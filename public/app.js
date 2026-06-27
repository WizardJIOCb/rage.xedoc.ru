// RAGE ARENA — Client
const socket = io();

let currentUser = null;
let users = []; // latest list from server
let isSilenced = false;

const joinScreen = document.getElementById('join-screen');
const app = document.getElementById('app');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const joinError = document.getElementById('join-error');

const playersList = document.getElementById('players-list');
const chatArea = document.getElementById('chat-area');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const onlineCount = document.getElementById('online-count');
const playersCount = document.getElementById('players-count');
const myStatus = document.getElementById('my-status');

// Join flow
joinBtn.addEventListener('click', attemptJoin);
usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptJoin();
});

function attemptJoin() {
  const name = usernameInput.value.trim();
  if (!name) {
    joinError.textContent = 'Введите имя';
    return;
  }
  joinError.textContent = '';
  socket.emit('join', name);
}

socket.on('joinError', (msg) => {
  joinError.textContent = msg;
});

socket.on('joined', ({ username }) => {
  currentUser = username;
  joinScreen.classList.add('hidden');
  app.classList.remove('hidden');
  messageInput.focus();

  // Add welcome message
  appendMessage({
    type: 'system',
    text: `Добро пожаловать в RAGE ARENA, ${username}!`,
    timestamp: Date.now()
  });
});

// Receive history on join
socket.on('messageHistory', (history) => {
  chatArea.innerHTML = '';
  history.forEach(m => appendMessage(m, true));
  scrollToBottom();
});

// User list updates
socket.on('userList', (list) => {
  users = list;
  renderPlayers();
  updateOnlineCount();
});

function updateOnlineCount() {
  const alive = users.filter(u => !u.isDead).length;
  onlineCount.textContent = users.length;
  playersCount.textContent = `${users.length} • ${alive} живы`;
}

function renderPlayers() {
  playersList.innerHTML = '';

  if (users.length === 0) {
    playersList.innerHTML = `<div class="text-center text-zinc-500 py-8 text-xs">Пока никого нет...</div>`;
    return;
  }

  // Sort: alive + higher rating first
  const sorted = [...users].sort((a, b) => {
    if (a.isDead !== b.isDead) return a.isDead ? 1 : -1;
    return b.rating - a.rating;
  });

  sorted.forEach(user => {
    const div = document.createElement('div');
    const isDead = user.isDead;
    const hpPercent = Math.max(0, Math.min(100, user.hp));
    let hpClass = 'high';
    if (hpPercent < 35) hpClass = 'low';
    else if (hpPercent < 65) hpClass = 'mid';

    div.className = `player-card px-3 py-2.5 rounded-2xl flex gap-3 items-center cursor-pointer ${isDead ? 'dead' : ''}`;
    
    const remaining = isDead ? Math.max(0, Math.ceil((user.deadUntil - Date.now()) / 1000)) : 0;

    div.innerHTML = `
      <div class="flex-1 min-w-0">
        <div class="flex items-baseline justify-between">
          <div class="name truncate ${isDead ? 'line-through text-zinc-400' : ''}">${escapeHtml(user.username)}</div>
          <div class="text-xs tabular-nums font-mono ${isDead ? 'text-red-700' : 'text-zinc-400'}">${user.rating}</div>
        </div>

        <div class="hp-container mt-1">
          <div class="hp-fill ${hpClass}" style="width: ${hpPercent}%"></div>
        </div>

        <div class="flex items-center justify-between mt-0.5">
          <div class="font-mono text-[10px] ${isDead ? 'text-red-400' : 'text-emerald-400'}">
            ${isDead ? '💀' : ''} ${user.hp}/100
          </div>
          ${isDead ? `<div class="text-[10px] font-mono text-red-400">⏱ ${remaining}с</div>` : ''}
        </div>
      </div>
    `;

    // Click inserts mention
    div.addEventListener('click', () => {
      if (currentUser && currentUser !== user.username) {
        insertMention(user.username);
      }
    });

    // Double click = quick roast
    div.addEventListener('dblclick', () => {
      if (currentUser && currentUser !== user.username && !isDead) {
        socket.emit('quickRoast', { target: user.username });
      }
    });

    playersList.appendChild(div);
  });

  // Update my status if exists
  updateMyStatus();
}

function insertMention(name) {
  const val = messageInput.value;
  const prefix = val.trim().length > 0 && !val.endsWith(' ') ? ' ' : '';
  messageInput.value = val + prefix + '@' + name + ' ';
  messageInput.focus();
  messageInput.selectionStart = messageInput.value.length;
}

function updateMyStatus() {
  const me = users.find(u => u.username === currentUser);
  if (!me) {
    myStatus.textContent = '';
    return;
  }

  if (me.isDead) {
    const secs = Math.max(0, Math.ceil((me.deadUntil - Date.now()) / 1000));
    myStatus.innerHTML = `<span class="text-red-500">💀 ЗАМОЛЧАЛ: ${secs}с</span>`;
    isSilenced = true;
  } else {
    myStatus.innerHTML = `HP <span class="font-bold text-emerald-400">${me.hp}</span> • ${me.rating} рейтинг`;
    isSilenced = false;
  }
}

// Periodic local countdown refresh for dead timers
setInterval(() => {
  if (users.some(u => u.isDead)) {
    renderPlayers();
  }
  // Also update my status
  const me = users.find(u => u.username === currentUser);
  if (me && me.isDead) updateMyStatus();
}, 1000);

// Chat sending
messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !currentUser) return;

  // Client-side quick check
  const me = users.find(u => u.username === currentUser);
  if (me && me.isDead) {
    appendMessage({ type: 'system', text: 'Ты замолчал! Подожди окончания таймера.', timestamp: Date.now() });
    messageInput.value = '';
    return;
  }

  socket.emit('chatMessage', { message: text });
  messageInput.value = '';
});

// Receive messages
socket.on('newMessage', (msg) => {
  appendMessage(msg);
  scrollToBottom();
});

// Attack visual + message
socket.on('attack', ({ attacker, target, damage }) => {
  const isMeTarget = target === currentUser;
  const isMeAttacker = attacker === currentUser;

  // Inject a nice attack line
  const attackLine = document.createElement('div');
  attackLine.className = `message system text-sm ${isMeTarget ? 'text-red-400' : ''}`;
  attackLine.innerHTML = `
    <span class="font-bold text-red-400">${escapeHtml(attacker)}</span> 
    <span class="text-red-500">напал на</span> 
    <span class="font-bold">${escapeHtml(target)}</span> 
    <span class="font-mono text-red-400">-${damage} HP</span>
  `;
  chatArea.appendChild(attackLine);
  scrollToBottom();

  // Visual flash on the player card if present
  flashPlayer(target, isMeTarget);

  if (isMeTarget) {
    // shake the whole chat a bit
    chatArea.style.transition = 'transform 80ms';
    chatArea.style.transform = 'translateX(2px)';
    setTimeout(() => {
      chatArea.style.transform = 'translateX(-1.5px)';
      setTimeout(() => chatArea.style.transform = '', 60);
    }, 70);
  }
});

socket.on('death', ({ username, attacker }) => {
  // Already handled by system message from server + userList
  // Extra flair
  const deathEl = document.createElement('div');
  deathEl.className = 'message death my-1';
  deathEl.textContent = `☠️ ${username} убит${attacker ? ' ' + attacker : ''}`;
  chatArea.appendChild(deathEl);
  scrollToBottom();
});

socket.on('silenced', (seconds) => {
  appendMessage({
    type: 'system',
    text: `Ты замолчал на ${seconds} сек. Нельзя отправлять сообщения.`,
    timestamp: Date.now()
  });
});

socket.on('revive', ({ username }) => {
  if (username === currentUser) {
    appendMessage({ type: 'system', text: '💚 Ты воскрес! HP восстановлено.', timestamp: Date.now() });
  }
});

// Render a chat message
function appendMessage(msg, skipScroll = false) {
  const el = document.createElement('div');

  const time = new Date(msg.timestamp || Date.now());
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (msg.type === 'system') {
    el.className = 'message system';
    el.innerHTML = `<span class="opacity-60">[${timeStr}]</span> ${escapeHtml(msg.text)}`;
  } else if (msg.type === 'death') {
    el.className = 'message death mx-auto my-1';
    el.textContent = msg.text;
  } else {
    // normal chat
    const isOwn = msg.sender === currentUser;
    el.className = `message px-4 py-2.5 rounded-3xl text-[15px] leading-snug break-words ${isOwn ? 'own' : 'other'}`;

    const senderHTML = !isOwn 
      ? `<div class="sender">${escapeHtml(msg.sender)}</div>` 
      : '';

    el.innerHTML = `
      ${senderHTML}
      <div>${escapeHtml(msg.text)}</div>
      <div class="text-[9px] text-right mt-px opacity-40 tabular-nums">${timeStr}</div>
    `;
  }

  chatArea.appendChild(el);

  // Trim old DOM messages
  while (chatArea.children.length > 90) {
    chatArea.removeChild(chatArea.firstChild);
  }

  if (!skipScroll) scrollToBottom();
}

function scrollToBottom() {
  chatArea.scrollTop = chatArea.scrollHeight;
}

function flashPlayer(username, isStrong = false) {
  // Find the player card and flash it
  const cards = Array.from(playersList.children);
  for (const card of cards) {
    if (card.textContent.includes(username)) {
      card.classList.add('attack-flash');
      if (isStrong) {
        card.style.boxShadow = '0 0 0 3px rgb(225 29 72 / 0.5)';
      }
      setTimeout(() => {
        card.classList.remove('attack-flash');
        card.style.boxShadow = '';
      }, 650);
      break;
    }
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}

// Keyboard shortcut: focus input on /
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement.tagName === 'BODY') {
    e.preventDefault();
    messageInput.focus();
  }
});

// Show instructions
function showInstructions() {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[100]';
  modal.innerHTML = `
    <div class="bg-zinc-900 max-w-lg w-full mx-4 rounded-2xl p-7 border border-zinc-700">
      <h3 class="font-black text-2xl mb-4">Как играть в RAGE ARENA</h3>
      
      <ul class="space-y-[13px] text-sm">
        <li class="flex gap-3"><span class="font-mono text-red-400 w-5">1.</span> <span>Упомяни человека через <span class="font-semibold">@Имя</span> в сообщении</span></li>
        <li class="flex gap-3"><span class="font-mono text-red-400 w-5">2.</span> <span>Добавь любое ругательство (сука, бля, пиздец, хуй, мудак...)</span></li>
        <li class="flex gap-3"><span class="font-mono text-red-400 w-5">3.</span> <span>Цель получает урон по HP (14-42 за атаку)</span></li>
        <li class="flex gap-3"><span class="font-mono text-red-400 w-5">4.</span> <span>Когда HP падает до 0 — игрок <strong>замолчает на 60 секунд</strong> и теряет рейтинг</span></li>
        <li class="flex gap-3"><span class="font-mono text-red-400 w-5">5.</span> <span>Клик по игроку в списке — быстро вставить @</span></li>
        <li class="flex gap-3"><span class="font-mono text-red-400 w-5">6.</span> <span>Двойной клик по игроку = быстрый роаст (авто-атака)</span></li>
      </ul>

      <div class="mt-6 text-xs bg-zinc-950 border border-zinc-800 p-3 rounded-xl">
        Боты тоже участвуют и будут тебя троллить. Открывай несколько вкладок с разными именами — будет ещё веселее!
      </div>

      <button class="mt-6 w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 font-bold rounded-xl" onclick="this.closest('.fixed').remove()">
        ПОНЯЛ, В БОЙ
      </button>
    </div>
  `;
  document.body.appendChild(modal);
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

// Boot: nice default name + enter hint
usernameInput.addEventListener('focus', () => {
  if (usernameInput.value === 'Боец') usernameInput.select();
});

console.log('%c[RAGE ARENA] Client ready. Open multiple tabs!', 'color:#444');