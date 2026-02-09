/**
 * Application entry point.
 * Creates HTTP server, attaches Socket.IO for realtime, starts listening.
 */

require('dotenv').config();
const http = require('http');
const { initDatabase } = require('./config/database');
const app = require('./app');
const { attachSocket } = require('./socket');

const PORT = process.env.PORT || 3000;

initDatabase();
console.log('Database ready.');

const server = http.createServer(app);
const io = require('socket.io')(server, {
  cors: { origin: '*' },
  path: '/socket.io',
});
app.locals.io = io;
attachSocket(io);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
