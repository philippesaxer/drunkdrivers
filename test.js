const { io } = require('socket.io-client');
const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('Connected');
  socket.emit('join', {name: 'test'});
  
  setTimeout(() => {
    socket.emit('request_respawn');
    console.log('Requested respawn');
  }, 1000);
  
  socket.on('respawned', () => {
    console.log('Respawned!');
    process.exit(0);
  });
  
  socket.on('killed', () => {
    console.log('killed');
  });
  
  setTimeout(() => {
    console.error('Timeout!');
    process.exit(1);
  }, 3000);
});
