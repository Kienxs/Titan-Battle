const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });

// --- CẤU HÌNH GAME ---
const MAP_W = 1000; // Mở rộng map một chút
const MAP_H = 800;
const PLAYER_SIZE = 30;
const BULLET_SPEED = 12;
const BASE_SPEED = 5;

let players = {};
let bullets = [];
let items = []; // Danh sách vật phẩm

// Class Vật phẩm
class Item {
    constructor() {
        this.id = Math.random().toString(36).substr(2, 9);
        this.x = Math.random() * (MAP_W - 20);
        this.y = Math.random() * (MAP_H - 20);
        this.type = Math.random() > 0.5 ? 'health' : 'speed'; // 50% ra máu, 50% ra tốc độ
    }
}

io.on('connection', (socket) => {
    console.log('Player joined: ' + socket.id);

    players[socket.id] = {
        x: Math.random() * (MAP_W - 50),
        y: Math.random() * (MAP_H - 50),
        color: `hsl(${Math.random() * 360}, 100%, 50%)`,
        hp: 100,
        score: 0,
        name: "P-" + socket.id.substr(0, 3),
        speed: BASE_SPEED,
        speedTimer: 0 // Thời gian còn lại của buff tốc độ
    };

    socket.on('move', (dir) => {
        const p = players[socket.id];
        if (!p || p.hp <= 0) return;

        // Xử lý di chuyển
        if (dir.up) p.y = Math.max(0, p.y - p.speed);
        if (dir.down) p.y = Math.min(MAP_H - PLAYER_SIZE, p.y + p.speed);
        if (dir.left) p.x = Math.max(0, p.x - p.speed);
        if (dir.right) p.x = Math.min(MAP_W - PLAYER_SIZE, p.x + p.speed);
    });

    socket.on('shoot', (angle) => {
        const p = players[socket.id];
        if (!p || p.hp <= 0) return;
        bullets.push({
            x: p.x + PLAYER_SIZE/2,
            y: p.y + PLAYER_SIZE/2,
            vx: Math.cos(angle) * BULLET_SPEED,
            vy: Math.sin(angle) * BULLET_SPEED,
            owner: socket.id
        });
    });

    socket.on('disconnect', () => { delete players[socket.id]; });
});

// GAME LOOP (60 FPS)
setInterval(() => {
    // 1. Sinh ra vật phẩm (Tối đa 5 món trên bản đồ)
    if (items.length < 5 && Math.random() < 0.02) {
        items.push(new Item());
    }

    // 2. Xử lý logic người chơi (Buff tốc độ & Ăn item)
    for (let id in players) {
        let p = players[id];
        
        // Giảm thời gian buff tốc độ
        if (p.speedTimer > 0) {
            p.speedTimer--;
            if (p.speedTimer <= 0) p.speed = BASE_SPEED;
        }

        // Kiểm tra ăn Item
        for (let i = items.length - 1; i >= 0; i--) {
            let it = items[i];
            let dist = Math.sqrt(Math.pow(p.x - it.x, 2) + Math.pow(p.y - it.y, 2));
            
            if (dist < PLAYER_SIZE) { // Ăn trúng
                if (it.type === 'health') {
                    p.hp = Math.min(100, p.hp + 30);
                } else if (it.type === 'speed') {
                    p.speed = BASE_SPEED * 2;
                    p.speedTimer = 300; // 5 giây (60 frames * 5)
                }
                items.splice(i, 1);
                io.to(id).emit('pickup', it.type); // Báo cho client biết đã ăn
            }
        }
    }

    // 3. Cập nhật đạn & Va chạm
    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        b.x += b.vx;
        b.y += b.vy;

        if (b.x < 0 || b.x > MAP_W || b.y < 0 || b.y > MAP_H) {
            bullets.splice(i, 1); continue;
        }

        for (let id in players) {
            let p = players[id];
            if (id !== b.owner && p.hp > 0) {
                const dx = b.x - (p.x + PLAYER_SIZE/2);
                const dy = b.y - (p.y + PLAYER_SIZE/2);
                if (Math.sqrt(dx*dx + dy*dy) < PLAYER_SIZE/2 + 5) {
                    p.hp -= 10;
                    bullets.splice(i, 1);
                    io.to(id).emit('hit');
                    
                    if (p.hp <= 0) {
                        if (players[b.owner]) players[b.owner].score++;
                        // Respawn Logic
                        p.hp = 100;
                        p.x = Math.random() * (MAP_W - 50);
                        p.y = Math.random() * (MAP_H - 50);
                        p.speed = BASE_SPEED;
                    }
                    break;
                }
            }
        }
    }

    io.emit('state', { players, bullets, items });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log('Server running on port ' + PORT); });