const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });

// --- CẤU HÌNH GAME ---
const MAP_W = 1000;
const MAP_H = 800;
const PLAYER_SIZE = 30;
const BULLET_SPEED = 12;
const BASE_SPEED = 5;

// Tối ưu CPU: Cache sẵn bình phương bán kính va chạm
const HIT_RADIUS_SQ = Math.pow(PLAYER_SIZE / 2 + 5, 2); 
const ITEM_RADIUS_SQ = Math.pow(PLAYER_SIZE, 2);

let players = {};
let bullets = [];
let items = [];

class Item {
    constructor() {
        this.id = Math.random().toString(36).substr(2, 9);
        this.x = Math.random() * (MAP_W - 20);
        this.y = Math.random() * (MAP_H - 20);
        this.type = Math.random() > 0.5 ? 'health' : 'speed';
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
        speedTimer: 0,
        moving: { up: false, down: false, left: false, right: false } // Biến lưu trạng thái di chuyển
    };

    // Server chỉ nhận sự thay đổi hướng di chuyển
    socket.on('move', (dir) => {
        if (players[socket.id]) {
            players[socket.id].moving = dir;
        }
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

    socket.on('disconnect', () => { 
        console.log('Player left: ' + socket.id);
        delete players[socket.id]; 
    });
});

// GAME LOOP (60 FPS)
setInterval(() => {
    // 1. Sinh ra vật phẩm
    if (items.length < 5 && Math.random() < 0.02) {
        items.push(new Item());
    }

    // 2. Cập nhật Player & Xử lý Item
    for (let id in players) {
        let p = players[id];
        
        // --- Xử lý di chuyển mượt mà trên Server ---
        if (p.moving.up) p.y = Math.max(0, p.y - p.speed);
        if (p.moving.down) p.y = Math.min(MAP_H - PLAYER_SIZE, p.y + p.speed);
        if (p.moving.left) p.x = Math.max(0, p.x - p.speed);
        if (p.moving.right) p.x = Math.min(MAP_W - PLAYER_SIZE, p.x + p.speed);

        // Giảm thời gian buff tốc độ
        if (p.speedTimer > 0) {
            p.speedTimer--;
            if (p.speedTimer <= 0) p.speed = BASE_SPEED;
        }

        // --- Kiểm tra ăn Item (Dùng bình phương khoảng cách) ---
        for (let i = items.length - 1; i >= 0; i--) {
            let it = items[i];
            let dx = p.x - it.x;
            let dy = p.y - it.y;
            
            if ((dx * dx + dy * dy) < ITEM_RADIUS_SQ) {
                if (it.type === 'health') {
                    p.hp = Math.min(100, p.hp + 30);
                } else if (it.type === 'speed') {
                    p.speed = BASE_SPEED * 2;
                    p.speedTimer = 300; 
                }
                items.splice(i, 1);
                io.to(id).emit('pickup', it.type); 
            }
        }
    }

    // 3. Cập nhật đạn & Va chạm
    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        b.x += b.vx;
        b.y += b.vy;

        // Xóa đạn bay ra ngoài map
        if (b.x < 0 || b.x > MAP_W || b.y < 0 || b.y > MAP_H) {
            bullets.splice(i, 1); continue;
        }

        let bulletHit = false;
        for (let id in players) {
            let p = players[id];
            if (id !== b.owner && p.hp > 0) {
                const dx = b.x - (p.x + PLAYER_SIZE/2);
                const dy = b.y - (p.y + PLAYER_SIZE/2);
                
                // Va chạm đạn (Dùng bình phương khoảng cách)
                if ((dx * dx + dy * dy) < HIT_RADIUS_SQ) {
                    p.hp -= 10;
                    bulletHit = true;
                    io.to(id).emit('hit');
                    
                    if (p.hp <= 0) {
                        if (players[b.owner]) players[b.owner].score++;
                        // Respawn
                        p.hp = 100;
                        p.x = Math.random() * (MAP_W - 50);
                        p.y = Math.random() * (MAP_H - 50);
                        p.speed = BASE_SPEED;
                        p.moving = { up: false, down: false, left: false, right: false };
                    }
                    break;
                }
            }
        }
        if (bulletHit) bullets.splice(i, 1);
    }

    // 4. Chuẩn bị State gửi xuống Client (Tối ưu băng thông)
    let minPlayers = {};
    for (let id in players) {
        let p = players[id];
        minPlayers[id] = {
            ...p,
            x: Math.round(p.x), // Bỏ phần thập phân
            y: Math.round(p.y),
            moving: undefined   // Không gửi dư thừa trạng thái di chuyển về client
        };
    }
    
    // Nén tọa độ Đạn và Item
    let minBullets = bullets.map(b => ({ x: Math.round(b.x), y: Math.round(b.y) }));
    let minItems = items.map(it => ({ x: Math.round(it.x), y: Math.round(it.y), type: it.type }));

    io.emit('state', { players: minPlayers, bullets: minBullets, items: minItems });

}, 1000 / 60);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log('Server running on port ' + PORT); });