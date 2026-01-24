const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });

// CẤU HÌNH GAME
const MAP_W = 800;
const MAP_H = 600;
const PLAYER_SIZE = 30;
const BULLET_SPEED = 10;
const PLAYER_SPEED = 5;

let players = {};
let bullets = [];

io.on('connection', (socket) => {
    console.log('Warrior joined: ' + socket.id);

    // Tạo nhân vật mới
    players[socket.id] = {
        x: Math.random() * (MAP_W - 50),
        y: Math.random() * (MAP_H - 50),
        color: `hsl(${Math.random() * 360}, 100%, 50%)`, // Màu neon ngẫu nhiên
        hp: 100,
        score: 0,
        name: "Player " + socket.id.substr(0, 4)
    };

    // Xử lý di chuyển (Client gửi yêu cầu, Server cập nhật)
    socket.on('move', (dir) => {
        const p = players[socket.id];
        if (!p || p.hp <= 0) return; // Chết rồi không đi được

        if (dir.up) p.y = Math.max(0, p.y - PLAYER_SPEED);
        if (dir.down) p.y = Math.min(MAP_H - PLAYER_SIZE, p.y + PLAYER_SPEED);
        if (dir.left) p.x = Math.max(0, p.x - PLAYER_SPEED);
        if (dir.right) p.x = Math.min(MAP_W - PLAYER_SIZE, p.x + PLAYER_SPEED);
    });

    // Xử lý bắn đạn
    socket.on('shoot', (angle) => {
        const p = players[socket.id];
        if (!p || p.hp <= 0) return;

        bullets.push({
            x: p.x + PLAYER_SIZE / 2,
            y: p.y + PLAYER_SIZE / 2,
            vx: Math.cos(angle) * BULLET_SPEED,
            vy: Math.sin(angle) * BULLET_SPEED,
            owner: socket.id
        });
    });

    socket.on('disconnect', () => { delete players[socket.id]; });
});

// GAME LOOP (Server chạy 60 FPS để tính toán va chạm)
setInterval(() => {
    // 1. Cập nhật vị trí đạn
    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        b.x += b.vx;
        b.y += b.vy;

        // Xóa đạn ra khỏi màn hình
        if (b.x < 0 || b.x > MAP_W || b.y < 0 || b.y > MAP_H) {
            bullets.splice(i, 1);
            continue;
        }

        // 2. Kiểm tra va chạm với người chơi
        for (let id in players) {
            let p = players[id];
            if (id !== b.owner && p.hp > 0) { // Không bắn trúng bản thân và người đã chết
                // Tính khoảng cách (Hitbox)
                const dx = b.x - (p.x + PLAYER_SIZE/2);
                const dy = b.y - (p.y + PLAYER_SIZE/2);
                const dist = Math.sqrt(dx*dx + dy*dy);

                if (dist < PLAYER_SIZE / 2 + 5) { // Va chạm!
                    p.hp -= 10;
                    bullets.splice(i, 1); // Xóa đạn
                    
                    // Gửi hiệu ứng rung lắc cho người bị trúng
                    io.to(id).emit('hit');

                    // Xử lý khi chết
                    if (p.hp <= 0) {
                        if (players[b.owner]) players[b.owner].score += 1; // Cộng điểm người bắn
                        // Hồi sinh sau 3 giây
                        p.x = -1000; // Giấu đi
                        setTimeout(() => {
                            if(players[id]) {
                                players[id].hp = 100;
                                players[id].x = Math.random() * (MAP_W - 50);
                                players[id].y = Math.random() * (MAP_H - 50);
                            }
                        }, 3000);
                    }
                    break; // Đạn trúng 1 người thôi
                }
            }
        }
    }

    // Gửi trạng thái mới nhất cho tất cả client
    io.emit('state', { players, bullets });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log('Server running on port ' + PORT); });