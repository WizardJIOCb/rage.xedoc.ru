// Quick automated test for RAGE ARENA core mechanics
// Connects two clients and verifies that insult with @mention deals damage

const { io } = require('socket.io-client');

const SERVER = 'http://localhost:3000';

function connectAndJoin(name) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER, { transports: ['websocket'] });

    socket.on('connect', () => {
      socket.emit('join', name);
    });

    socket.on('joined', ({ username }) => {
      console.log(`[${username}] joined successfully`);
      resolve({ socket, username });
    });

    socket.on('joinError', (err) => {
      reject(new Error(`${name} join error: ${err}`));
    });

    socket.on('connect_error', reject);
  });
}

async function runTest() {
  console.log('=== RAGE ARENA MECHANICS TEST ===\n');

  let tester, victim;
  let finalList = null;

  try {
    // Connect two players
    [tester, victim] = await Promise.all([
      connectAndJoin('TestAttacc'),
      connectAndJoin('TestVictim')
    ]);

    // Wait a bit for bots and initial state
    await new Promise(r => setTimeout(r, 800));

    // Capture user list updates
    const userStates = [];

    victim.socket.on('userList', (list) => {
      const v = list.find(u => u.username === 'TestVictim');
      if (v) userStates.push({ hp: v.hp, isDead: v.isDead, rating: v.rating });
    });

    tester.socket.on('userList', (list) => {
      finalList = list;
    });

    tester.socket.on('attack', (data) => {
      console.log(`[ATTACK EVENT] ${data.attacker} → ${data.target} for ${data.damage} damage`);
    });

    // Get initial state
    tester.socket.emit('chatMessage', { message: 'hello world' }); // normal message, no effect
    await new Promise(r => setTimeout(r, 400));

    const initialVictim = userStates.length ? userStates[userStates.length-1] : null;
    console.log('Initial victim HP check...');

    // THE KEY TEST: send insult with mention
    console.log('\nSending attack: "@TestVictim ты сука бля!" from TestAttacc\n');
    tester.socket.emit('chatMessage', { message: '@TestVictim ты сука бля!' });

    // Wait for damage + broadcasts
    await new Promise(r => setTimeout(r, 1200));

    // Check result
    const after = userStates[userStates.length - 1] || { hp: 'unknown' };

    if (userStates.length < 2) {
      console.log('Warning: not enough userList updates received.');
    }

    console.log('\n=== RESULTS ===');
    console.log('Attack sent with swear + mention.');
    console.log('Victim HP after attack:', after.hp);

    // Additional check via direct list
    const victimData = finalList?.find(u => u.username === 'TestVictim');
    if (victimData) {
      console.log('Victim HP from final list:', victimData.hp);
      console.log('Victim rating:', victimData.rating);
    }

    const success = victimData && victimData.hp < 100;
    console.log(success ? '\n✅ SUCCESS: Damage was applied!' : '\n❌ FAIL: No damage detected');

    // Test second attack to push toward death (optional)
    console.log('\nSending second heavy attack...');
    tester.socket.emit('chatMessage', { message: '@TestVictim пиздец хуйло ебаное!' });
    await new Promise(r => setTimeout(r, 1000));

    const after2 = finalList?.find(u => u.username === 'TestVictim');
    console.log('Victim HP after 2nd attack:', after2 ? after2.hp : 'n/a');

    if (after2 && after2.hp <= 0) {
      console.log('☠️ Victim reached 0 HP (will be silenced)');
    }

  } catch (err) {
    console.error('Test error:', err.message);
  } finally {
    // Cleanup sockets
    if (tester) tester.socket.disconnect();
    if (victim) victim.socket.disconnect();
    console.log('\nTest sockets closed.');
    setTimeout(() => process.exit(0), 300);
  }
}

runTest();