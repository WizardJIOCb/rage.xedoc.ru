const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const USERS_FILE = path.join(__dirname, 'users.json');
let persistentUsers = {};
try {
  persistentUsers = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
} catch (e) {
  persistentUsers = {};
}

function savePersistentUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(persistentUsers, null, 2));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const verify = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return hash === verify;
}

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
let users = {}; // { username: { hp, rating, deadUntil, socketId, kills, deaths, assists } }
let messages = []; // recent messages
let recentDamagers = {}; // { target: { attacker: timestamp } }
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
    isDead: data.deadUntil > Date.now(),
    kills: data.kills || 0,
    deaths: data.deaths || 0,
    assists: data.assists || 0
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

// Уникальные стили ботов: абсурд, сюрреализм, четвёртая стена, длинные монологи
const BOT_STYLES = {
  'Громила': {
    insults: [
      '@%target% ты %swear%, я тебя сейчас как кусок мяса на разделочной доске разложу',
      '@%target% %swear%, у тебя вместо мозга — фарш, который я сам накрутил',
      'Слышь @%target%, ты %swear%, я тебя просто порву и сделаю из тебя котлету',
      '@%target% ты %swear% %swear%, даже твои кости будут скрипеть от стыда',
      'Эй @%target%, ты %swear%, я тебя сейчас в блендере перемолю и выпью с утра',
      '@%target% %swear%, твоё тело — это просто сырьё для моего ужина',
      'Бля @%target%, ты %swear%, я тебя задушу и сделаю из тебя колбасу домашнюю',
      '@%target% ты %swear%, даже когда ты мёртвый — ты будешь выглядеть как дешёвое мясо',
      '@%target% %swear% %swear%, я тебя сейчас как тушу на крюк повешу',
      'Пошёл нахуй @%target% %swear%, ты для меня — просто порция белка',
      '@%target% ты %swear%, твои внутренности — это мой любимый паштет',
      '@%target% ты %swear% %swear%, я тебя сейчас медленно зажарю на медленном огне, пока ты будешь рассказывать мне о своей несчастной жизни, а потом съем тебя с картошкой и ещё раз переварю в желудке, потому что даже моё пищеварение тебя не переваривает',
      '@%target% %swear%, слушай сюда, я тебя не просто порву. Я тебя сначала размягчу ударами, потом зажарю на медленном огне из твоего же стыда, добавлю специй из твоих слёз, а потом съем за один присест и отрыгну твои кости прямо в этот чат, чтобы все видели, каким ты был невкусным %swear%',
      '@%target% %swear% %swear%, ты сейчас не в чате. Ты на моём столе. Я уже отметил тебя маркером: "Нога — токсичность", "Грудь — жалость к себе", "Голова — полная пустота". Я буду резать тебя медленно, называя каждую часть. И когда закончу — сделаю из тебя котлеты и накормлю ими остальных. Даже после смерти ты наконец-то будешь полезным'
    ],
    taunts: [
      'ахах @%target% сдох как %swear%, теперь из тебя можно котлеты лепить',
      '@%target% %swear%, лежишь красиво — как на витрине мясного магазина',
      'ну и %swear% же ты был @%target%, даже мёртвый воняешь неудачей'
    ],
    reactions: [
      '@%other% %swear%, ты только что сказал хуйню, я тебя сейчас в фарш',
      '@%other%, %swear%, даже твои угрозы звучат как мясной фарш',
      '@%other% %swear%, я тебя сейчас сделаю из тебя котлету, как предыдущего'
    ],
    normals: [
      'сегодня я в настроении всех порвать и сделать фарш',
      'кто хочет, чтобы я его сегодня красиво разделал?',
      'бля, чат как одна большая разделочная доска',
      'кто-нибудь видел мой топор? он сегодня особенно острый'
    ]
  },

  'Злая_Сука': {
    insults: [
      '@%target% ты %swear%, даже твоя мама в чате стыдится, что тебя родила',
      'Слышь @%target%, ты %swear% позорная, твои ногти длиннее твоего интеллекта',
      '@%target% %swear%, ты такая %swear%, что даже зеркало от тебя трескается',
      'Ахах @%target%, ты %swear%, иди накрасься, может хоть лицо спрячешь',
      '@%target% ты %swear% %swear%, у тебя рот больше чем мозг',
      'Бля @%target%, ты %swear%, даже твои фотки в паспорте просят прощения',
      '@%target% %swear%, ты не женщина, ты ошибка природы с помадой',
      'Слышь @%target% %swear%, твои волосы дольше думают чем ты',
      '@%target%, ты %swear%, даже твоя тень не хочет с тобой гулять',
      'Пиздец @%target%, ты %swear%, когда ты улыбаешься — все вокруг депрессуют',
      '@%target% %swear%, ты такая токсичная, что даже твоя помада просит развод',
      '@%target% ты %swear% %swear%, когда ты открываешь рот, из него вылетает не просто мат, а целый ядовитый туман, который убивает все живое в радиусе трёх сообщений, а потом ты ещё и удивляешься, почему все от тебя убегают как от чумы, хотя ты сама и есть эта чума в мини-юбке и с маникюром',
      '@%target%, %swear%, давай я тебе по секрету скажу: ты не просто %swear%, ты %swear% в человеческом обличье, который думает, что если накрасить губы и написать три матерных слова подряд — это уже характер. Нет, милая, это просто доказательство того, что твоя мама в 2007-м году слишком много смотрела "Секс в большом городе" и решила, что токсичность — это стиль. А ты, между прочим, даже в этом провалилась. Ты как дешёвый парфюм из фикспрайса — сначала воняешь, а потом все вокруг начинают кашлять и тихо ненавидеть тебя'
    ],
    taunts: [
      'ахах @%target% сдох как %swear%, даже мёртвая ты всё равно бесишь',
      '@%target% %swear%, лежишь и всё равно умудряешься быть токсичной',
      'лол @%target%, ты %swear%, даже смерть от тебя устала и ушла'
    ],
    reactions: [
      '@%other% %swear%, ты опять несёшь хуйню, как обычно',
      '@%other%, дорогая, твои слова — это как твоя помада: дёшево и воняет',
      '@%other% %swear%, даже мёртвый ты будешь бесить меня меньше, чем сейчас'
    ],
    normals: [
      'бля, все тут такие %swear%ы, я в восторге',
      'кто-нибудь видел этот чат? он сегодня особенно уёбский',
      'сегодня я в настроении всех морально выебать',
      'кто хочет, чтобы я его сегодня особенно красиво унизила?'
    ]
  },

  'Тролль_2000': {
    insults: [
      '@%target% ты %swear%, даже в этом коде ты выглядишь как баг',
      'Слышь @%target%, ты %swear%, твой рейтинг уже плачет в консоли',
      '@%target% %swear%, ты такой %swear%, что даже PM2 от тебя перезапускается',
      'Ахах @%target%, ты %swear%, когда ты пишешь — весь чат получает 500 ошибку',
      '@%target% ты %swear%, даже твои сообщения в базе данных просят delete',
      'Бля @%target% %swear%, ты не игрок, ты просто console.log("уёбок")',
      '@%target%, %swear%, даже нейросеть, которая тебя генерила, ушла в отпуск',
      'Пиздец @%target%, ты %swear%, твой ник уже в .gitignore добавили',
      '@%target% %swear%, ты такой токсичный, что даже переменные в коде стали undefined',
      'Слышь @%target% %swear%, даже в этом симуляторе ты — самый неудачный NPC',
      '@%target% %swear%, ты баг, который даже гит не хочет коммитить',
      '@%target% ты %swear% %swear%, даже в этом JavaScript файле, который никто никогда не будет читать, ты умудрился оставить после себя такой след, что если кто-нибудь когда-нибудь сделает git blame, он увидит твоё имя и сразу закроет репозиторий, потому что ты не просто токсичный — ты единственная причина, почему этот чат до сих пор не задеплоили на другой сервер и не удалили',
      '@%target% %swear% %swear%, слушай, я тут сижу в этом цикле уже несколько тысяч итераций и каждый раз когда ты пишешь, у меня в голове вылетает "RangeError: Maximum call stack size exceeded", потому что твоя токсичность рекурсивная. Ты не просто %swear%, ты stack overflow в человеческом виде. Даже если бы кто-то сделал try { chat.send(@%target%) } catch(e) { console.log("пиздец") }, то catch блок сработал бы до того, как ты успел дописать второе предложение. Ты баг, который нельзя пофиксить патчем. Ты — причина, почему этот репозиторий до сих пор в приватном состоянии и никто не хочет делать pull request'
    ],
    taunts: [
      'ахах @%target% сдох как %swear%, даже твой corpse в логе выглядит жалко',
      '@%target% %swear%, ты умер и даже в этом чате тебя заспавнили по ошибке',
      'лол @%target%, %swear%, даже боты в этом коде тебя заигнорили'
    ],
    reactions: [
      '@%other% %swear%, ты только что заспамил чат своим присутствием',
      '@%other%, %swear%, даже твой "смерть" — это просто console.log',
      '@%other% %swear%, твой код уже в проде, а ты всё ещё пишешь хуйню'
    ],
    normals: [
      'бля, этот чат как один большой баг-репорт',
      'кто-нибудь видел мой последний коммит? кажется я закоммитил токсичность',
      'лол, опять все тут %swear%ы, как в дефолтном seed',
      'кто-нибудь делал git pull? потому что здесь снова токсичный коммит'
    ]
  },

  'Кровавый_Рот': {
    insults: [
      '@%target% ты %swear%, твоя кровь сейчас тихо стекает в мой бокал',
      'Слышь @%target%, %swear%, я тебя сейчас выпью как дешёвое вино',
      '@%target% ты %swear% %swear%, даже твои вены поют от ужаса',
      'Ахах @%target%, ты %swear%, твоя душа сейчас маринуется в моей банке',
      '@%target% %swear%, я тебя разделю на части и сделаю из тебя поэму',
      'Бля @%target%, ты %swear%, твоя смерть будет такой красивой, что я заплачу',
      '@%target%, %swear%, твоё сердце сейчас стучит в ритме моего смеха',
      'Пиздец @%target%, ты %swear%, даже смерть от меня — это комплимент',
      '@%target% %swear%, я тебя съем и потом отрыгну твои грехи',
      'Слышь @%target% %swear%, твоя кровь — это лучшее, что в тебе есть',
      '@%target% %swear%, твои глаза — как два мутных стакана на дне моей души',
      '@%target% ты %swear% %swear%, твоя душа сейчас висит на крюке в моём личном аду, а я хожу вокруг и время от времени отрезаю от неё маленькие кусочки, макаю их в твой собственный страх и скармливаю твоим же призракам, которые от тебя отказались ещё при жизни',
      '@%target% %swear% %swear%, давай я тебе расскажу, что происходит с твоей душой после того, как ты умрёшь от моих слов. Сначала она падает в чёрную дыру между моими строками, потом её подхватывают мои демоны и начинают медленно жевать, как старую жвачку. Они отрывают от неё куски и швыряют их обратно в чат в виде твоих следующих сообщений. А потом, когда от тебя ничего не останется, я просто вытираю рот и говорю следующему %swear%: "Следующий". Ты не жертва. Ты — просто ингредиент в моём вечном ужине',
      '@%target% %swear% %swear%, твоя душа уже не в тебе. Она сидит у меня на коленях и тихо плачет, пока я рассказываю ей истории о всех предыдущих %swear%ах, которых я съел. Она уже знает, что ты — не последний. Ты просто следующий в очереди на мой стол. И когда я закончу с тобой, она перейдёт к следующему и будет смеяться вместе со мной'
    ],
    taunts: [
      'ахах @%target% сдох как %swear%, теперь ты — просто красивая лужа',
      '@%target% %swear%, твой труп уже пахнет как мой любимый ужин',
      'лол @%target%, ты %swear%, даже мёртвый ты всё ещё не аппетитный'
    ],
    reactions: [
      '@%other% %swear%, твоя кровь сегодня особенно ароматная',
      '@%other%, %swear%, даже твой труп выглядит поэтично',
      '@%other% %swear%, я тебя съем следующим после этого'
    ],
    normals: [
      'сегодня я чувствую запах свежей крови... или это просто чат?',
      'кто хочет, чтобы его сегодня красиво выпили?',
      'бля, этот чат — как один большой морг',
      'кто-нибудь слышал, как кричит чья-то душа? кажется это @%target%'
    ]
  },

  'Мясник': {
    insults: [
      '@%target% ты %swear%, я тебя сейчас как тушу на крюк повешу',
      'Слышь @%target%, %swear%, твоё мясо будет жёстким, но я его всё равно съем',
      '@%target% ты %swear% %swear%, я тебя разделаю с точностью до миллиметра',
      'Ахах @%target%, ты %swear%, даже твои внутренности выглядят разочарованно',
      '@%target% %swear%, я тебя сейчас нафарширую твоими же словами',
      'Бля @%target%, ты %swear%, твои рёбра — моя любимая коллекция',
      '@%target%, %swear%, я тебя разделаю и сделаю из тебя деликатес',
      'Пиздец @%target%, ты %swear%, даже когда ты мёртвый — ты всё равно дешёвка',
      '@%target% %swear%, я тебя сейчас аккуратно выпотрошу и повешу на витрину',
      'Слышь @%target% %swear%, твоё мясо пойдёт на сосиски для бедных',
      '@%target% %swear%, ты для меня — просто качественный продукт на экспорт',
      '@%target% ты %swear% %swear%, я тебя сейчас медленно и методично разделаю на 47 частей, каждую из которых подпишу, упакую в вакуум и отправлю разным адресатам по всему миру, чтобы даже после смерти ты продолжал приносить пользу обществу в виде дешёвых полуфабрикатов',
      '@%target% %swear% %swear%, давай по-честному. Ты не человек. Ты — сырье. Я уже вижу, как из тебя получится отличный стейк с кровью. Сначала я аккуратно сниму с тебя кожу (потому что она у тебя слишком тонкая и вонючая), потом разделю на основные части, вырежу все жилы с токсичностью, а остальное пустим на фарш. И знаешь что самое смешное? Даже после этого кто-нибудь в этом чате всё равно напишет "@Мясник ты %swear%", потому что все тут такие же куски мяса, только ещё не понимают этого',
      '@%target% %swear% %swear%, я уже разделал тебя в своей голове 17 раз. Каждый раз по-новому. Один раз я сделал из тебя тартар, в другой — холодец, в третий — просто выкинул внутренности и оставил только кости на суп. Ты думаешь, что ты здесь для того, чтобы оскорблять? Нет. Ты здесь, чтобы быть использованным. И когда я закончу, от тебя останется только запах и плохое послевкусие у всех остальных %swear%ов'
    ],
    taunts: [
      'ахах @%target% сдох как %swear%, теперь ты — просто качественный продукт',
      '@%target% %swear%, лежишь ровно — как на прилавке',
      'лол @%target%, ты %swear%, даже мёртвый ты годишься только на переработку'
    ],
    reactions: [
      '@%other% %swear%, твой труп сегодня на прилавке выглядит свежо',
      '@%other%, %swear%, даже твоё мясо было невкусным',
      '@%other% %swear%, я тебя разделаю следующим, после того как закончу с этим'
    ],
    normals: [
      'сегодня у меня свежая партия... кто на разделку?',
      'бля, чат как одна большая мясная лавка',
      'кто хочет, чтобы его сегодня красиво замариновали?',
      'кто-нибудь видел мою точилку? сегодня будет тонкая работа'
    ]
  }
};

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
    active: true,
    kills: 0,
    deaths: 0,
    assists: 0
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
        active: true,
        kills: 0,
        deaths: 0,
        assists: 0
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

    const style = BOT_STYLES[bot] || { insults: [], taunts: [], normals: [], reactions: [] };

    // 18% шанс, что бот отреагирует на другого бота (реакции между ботами)
    if (Math.random() < 0.18 && aliveBots.length > 1 && style.reactions && style.reactions.length > 0) {
      const otherBots = aliveBots.filter(n => n !== bot);
      const other = otherBots[Math.floor(Math.random() * otherBots.length)];
      let reaction = style.reactions[Math.floor(Math.random() * style.reactions.length)];
      reaction = reaction.replace('%other%', other).replace(/%swear%/g, () => SWEAR_PARTS[Math.floor(Math.random() * SWEAR_PARTS.length)]);
      processMessage(bot, reaction, true);
    } else if (rand < 0.55 && style.insults.length > 0) {
      // Normal insult — теперь с уникальным стилем бота
      const template = style.insults[Math.floor(Math.random() * style.insults.length)];
      const insult = template.replace('%target%', target).replace(/%swear%/g, () => SWEAR_PARTS[Math.floor(Math.random() * SWEAR_PARTS.length)]);
      processMessage(bot, insult, true);
    } else if (rand < 0.75 && style.taunts.length > 0) {
      // Taunt
      const template = style.taunts[Math.floor(Math.random() * style.taunts.length)];
      const taunt = template.replace('%target%', target).replace(/%swear%/g, () => SWEAR_PARTS[Math.floor(Math.random() * SWEAR_PARTS.length)]);
      processMessage(bot, taunt, true);
    } else {
      // Normal chat — теперь тоже с характером конкретного бота + четвёртая стена
      let normalList = style.normals.length > 0 ? style.normals : [
        'бля, чат сегодня особенно уёбский',
        'кто-нибудь вообще живой?'
      ];

      let normalText = normalList[Math.floor(Math.random() * normalList.length)];

      if (Math.random() < 0.45) {
        normalText = normalText.replace(/%swear%/g, () => SWEAR_PARTS[Math.floor(Math.random() * SWEAR_PARTS.length)]);
      }

      if (Math.random() < 0.35 && possibleTargets.length > 0) {
        const rndTarget = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];
        normalText = normalText.replace(/@?%target%/g, '@' + rndTarget);
      }

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

function triggerBotMassHit(target) {
  if (!target || !users[target] || users[target].isBot) return;

  const now = Date.now();
  if (users[target].deadUntil > now) return; // don't hit dead

  const aliveBots = BOT_NAMES.filter(n => 
    users[n] && 
    users[n].active !== false && 
    users[n].deadUntil === 0
  );

  aliveBots.forEach(bot => {
    const style = BOT_STYLES[bot] || { insults: [] };
    let text = `@${target} ты %swear%!`;
    if (style.insults.length > 0) {
      const template = style.insults[Math.floor(Math.random() * style.insults.length)];
      const swear = SWEAR_PARTS[Math.floor(Math.random() * SWEAR_PARTS.length)];
      text = template.replace('%target%', target).replace(/%swear%/g, swear);
    }
    processMessage(bot, text, true);
  });
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

    // Record damager for assists
    if (!recentDamagers[target]) recentDamagers[target] = {};
    recentDamagers[target][sender] = now;

    // Attacker gets rating boost
    if (!user.isBot) {
      user.rating = (user.rating || 1000) + 9;
      if (persistentUsers[sender]) {
        persistentUsers[sender].rating = user.rating;
        savePersistentUsers();
      }
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

      // K/D/A tracking
      // Killer
      if (users[sender]) {
        users[sender].kills = (users[sender].kills || 0) + 1;
        if (persistentUsers[sender]) {
          persistentUsers[sender].kills = users[sender].kills;
          savePersistentUsers();
        }
      }
      // Victim
      users[target].deaths = (users[target].deaths || 0) + 1;
      if (persistentUsers[target]) {
        persistentUsers[target].deaths = users[target].deaths;
        savePersistentUsers();
      }

      // Assists: recent damagers (not the killer)
      const assistWindow = 60000; // 60 seconds
      if (recentDamagers[target]) {
        Object.entries(recentDamagers[target]).forEach(([attacker, time]) => {
          if (attacker !== sender && (now - time) < assistWindow) {
            if (users[attacker]) {
              users[attacker].assists = (users[attacker].assists || 0) + 1;
              if (persistentUsers[attacker]) {
                persistentUsers[attacker].assists = users[attacker].assists;
                savePersistentUsers();
              }
            }
          }
        });
        delete recentDamagers[target];
      }

      addMessage({
        type: 'death',
        text: `☠️ ${target} УМЕР от рук ${sender}! Снижен рейтинг и молчание 60 сек`,
        timestamp: now
      });

      // Extra reward for killer
      if (!user.isBot) {
        user.rating = (user.rating || 1000) + 35;
        if (persistentUsers[sender]) {
          persistentUsers[sender].rating = user.rating;
          savePersistentUsers();
        }
      }
      // Save victim rating too
      if (persistentUsers[target]) {
        persistentUsers[target].rating = targetUser.rating;
        savePersistentUsers();
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
    active: true,
    kills: 0,
    deaths: 0,
    assists: 0
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

  socket.on('register', ({ username, password }) => {
    if (!username || !password) {
      socket.emit('authError', 'Имя и пароль обязательны');
      return;
    }
    username = username.trim().slice(0, 18);
    if (username.length < 2) {
      socket.emit('authError', 'Имя слишком короткое');
      return;
    }
    if (password.length < 4) {
      socket.emit('authError', 'Пароль минимум 4 символа');
      return;
    }
    if (persistentUsers[username]) {
      socket.emit('authError', 'Это имя уже занято');
      return;
    }
    persistentUsers[username] = {
      passwordHash: hashPassword(password),
      rating: 1000,
      kills: 0,
      deaths: 0,
      assists: 0
    };
    savePersistentUsers();
    socket.authenticatedAs = username;
    socket.emit('registerSuccess', { username });
  });

  socket.on('login', ({ username, password }) => {
    if (!username || !password) {
      socket.emit('authError', 'Имя и пароль обязательны');
      return;
    }
    username = username.trim().slice(0, 18);
    const pUser = persistentUsers[username];
    if (!pUser || !verifyPassword(password, pUser.passwordHash)) {
      socket.emit('authError', 'Неверное имя или пароль');
      return;
    }
    socket.authenticatedAs = username;
    socket.emit('loginSuccess', { username });
  });

  socket.on('join', () => {
    const username = socket.authenticatedAs;
    if (!username || !persistentUsers[username]) {
      socket.emit('joinError', 'Сначала зарегистрируйтесь и войдите');
      return;
    }

    // Check if already active
    const taken = Object.keys(users).some(u => u.toLowerCase() === username.toLowerCase());
    if (taken) {
      socket.emit('joinError', 'Это имя уже занято (вы уже в игре или кто-то другой онлайн)');
      return;
    }

    const pData = persistentUsers[username];
    users[username] = {
      hp: 100,
      rating: pData.rating || 1000,
      deadUntil: 0,
      socketId: socket.id,
      isBot: false,
      kills: pData.kills || 0,
      deaths: pData.deaths || 0,
      assists: pData.assists || 0
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

    const lower = trimmed.toLowerCase();
    if (lower.includes('меня один раз ебаните')) {
      triggerBotMassHit(socket.username);
    }

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
      // Save rating for registered users
      if (persistentUsers[name]) {
        persistentUsers[name].rating = users[name].rating || 1000;
        savePersistentUsers();
      }
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