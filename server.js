const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

let players = {};

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    console.log('Người chơi mới: ' + socket.id);
    
    // Khởi tạo người chơi mới
    players[socket.id] = {
        x: Math.random() * 700,
        y: Math.random() * 400,
        color: '#' + Math.floor(Math.random()*16777215).toString(16)
    };

    // Gửi danh sách người chơi cho mọi người
    io.emit('update', players);

    // Xử lý khi có người di chuyển
    socket.on('move', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            io.emit('update', players);
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('update', players);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log('Server đang chạy tại port ' + PORT);
});