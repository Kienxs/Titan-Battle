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
const RESPAWN_TIME_MS = 3000; // Thời gian cooldown hồi sinh (3 giây)

const HIT_RADIUS_SQ = Math.pow(PLAYER_SIZE / 2 + 5, 2); 
const ITEM_RADIUS_SQ = Math.pow(PLAYER_SIZE, 2);
const BOMB_RADIUS_SQ = Math.pow(PLAYER_SIZE / 2 + 12, 2);

// Danh sách vật chắn (Obstacles)
const walls = [
    { x: 200, y: 150, w: 150, h: 40 },
    { x: 650, y: 150, w: 150, h: 40 },
    { x: 450, y: 350, w: 100, h: 100 }, // Khối vuông ở giữa
    { x: 200, y: 600, w: 40, h: 150 },
    { x: 760, y: 600, w: 40, h: 150 }
];

let players = {};
let bullets = [];
let items = [];
let bombs = [];

// Hàm hỗ trợ kiểm tra va chạm Hình Chữ Nhật (AABB)
function rectIntersect(x1, y1, w1, h1, x2, y2, w2, h2) {
    return x2 < x1 + w1 && x2 + w2 > x1 && y2 < y1 + h1 && y2 + h2 > y1;
}

class Item {
    constructor() {
        this.id = Math.random().toString(36).substr(2, 9);
        this.x = Math.random() * (MAP_W - 20);
        this.y = Math.random() * (MAP_H - 20);
        this.type = Math.random() > 0.5 ? 'health' : 'speed';
    }
}

io.on('connection', (socket) => {
    // Gửi ngay danh sách vật chắn cho client mới
    socket.emit('init', { walls: walls });

    players[socket.id] = {
        x: Math.random() * (MAP_W - 50),
        y: Math.random() * (MAP_H - 50),
        color: `hsl(${Math.random() * 360}, 100%, 50%)`,
        hp: 100,
        score: 0,
        name: "P-" + socket.id.substr(0, 3),
        speed: BASE_SPEED,
        speedTimer: 0,
        moving: { up: false, down: false, left: false, right: false },
        dead: false,
        respawnTime: 0
    };

    socket.on('move', (dir) => {
        if (players[socket.id]) players[socket.id].moving = dir;
    });

    socket.on('shoot', (angle) => {
        const p = players[socket.id];
        if (!p || p.hp <= 0 || p.dead) return; // Chết thì không được bắn
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

function handlePlayerDeath(p, killerId) {
    p.hp = 0;
    p.dead = true;
    p.respawnTime = Date.now() + RESPAWN_TIME_MS;
    p.moving = { up: false, down: false, left: false, right: false }; // Khóa di chuyển
    
    // Cộng điểm cho người giết (nếu có)
    if (killerId && players[killerId] && killerId !== "BOMB") {
        players[killerId].score++;
    }
}

// GAME LOOP (60 FPS)
setInterval(() => {
    // Sinh Item
    if (items.length < 5 && Math.random() < 0.02) items.push(new Item());

    // Sinh Boom ngẫu nhiên
    if (bombs.length < 4 && Math.random() < 0.005) {
        bombs.push({
            x: Math.random() * (MAP_W - 40) + 20,
            y: Math.random() * (MAP_H - 40) + 20
        });
    }

    // Xử lý Người chơi
    for (let id in players) {
        let p = players[id];
        
        // Logic Hồi Sinh (Respawn)
        if (p.dead) {
            if (Date.now() >= p.respawnTime) {
                p.dead = false;
                p.hp = 100;
                p.x = Math.random() * (MAP_W - 50);
                p.y = Math.random() * (MAP_H - 50);
                p.speed = BASE_SPEED;
            }
            continue; // Nếu đang chết thì bỏ qua việc di chuyển và xét va chạm
        }
        
        // --- Xử lý di chuyển CÓ va chạm với tường ---
        let nextX = p.x;
        let nextY = p.y;

        if (p.moving.left) nextX = Math.max(0, p.x - p.speed);
        if (p.moving.right) nextX = Math.min(MAP_W - PLAYER_SIZE, p.x + p.speed);
        
        // Kiểm tra va chạm trục X
        let collideX = walls.some(w => rectIntersect(nextX, p.y, PLAYER_SIZE, PLAYER_SIZE, w.x, w.y, w.w, w.h));
        if (!collideX) p.x = nextX; // Chỉ di chuyển nếu không chạm tường

        if (p.moving.up) nextY = Math.max(0, p.y - p.speed);
        if (p.moving.down) nextY = Math.min(MAP_H - PLAYER_SIZE, p.y + p.speed);

        // Kiểm tra va chạm trục Y
        let collideY = walls.some(w => rectIntersect(p.x, nextY, PLAYER_SIZE, PLAYER_SIZE, w.x, w.y, w.w, w.h));
        if (!collideY) p.y = nextY;

        // Giảm thời gian buff tốc độ
        if (p.speedTimer > 0) {
            p.speedTimer--;
            if (p.speedTimer <= 0) p.speed = BASE_SPEED;
        }

        // Kiểm tra ăn Item
        for (let i = items.length - 1; i >= 0; i--) {
            let it = items[i];
            let dx = p.x - it.x; let dy = p.y - it.y;
            if ((dx * dx + dy * dy) < ITEM_RADIUS_SQ) {
                if (it.type === 'health') p.hp = Math.min(100, p.hp + 30);
                else if (it.type === 'speed') { p.speed = BASE_SPEED * 2; p.speedTimer = 300; }
                items.splice(i, 1);
                io.to(id).emit('pickup', it.type); 
            }
        }

        // Kiểm tra đạp Boom
        for (let i = bombs.length - 1; i >= 0; i--) {
            let b = bombs[i];
            let dx = (p.x + PLAYER_SIZE/2) - b.x; 
            let dy = (p.y + PLAYER_SIZE/2) - b.y;
            if ((dx * dx + dy * dy) < BOMB_RADIUS_SQ) {
                p.hp -= 50; // Trừ 50 máu khi đạp mìn
                bombs.splice(i, 1);
                io.to(id).emit('explosion'); 
                
                if (p.hp <= 0) {
                    handlePlayerDeath(p, "BOMB");
                }
            }
        }
    }

    // Xử lý Đạn & Va chạm
    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        b.x += b.vx;
        b.y += b.vy;

        // Xóa đạn bay ra ngoài map
        if (b.x < 0 || b.x > MAP_W || b.y < 0 || b.y > MAP_H) {
            bullets.splice(i, 1); continue;
        }

        // Va chạm Đạn với Tường
        let hitWall = walls.some(w => b.x >= w.x && b.x <= w.x + w.w && b.y >= w.y && b.y <= w.y + w.h);
        if (hitWall) {
            bullets.splice(i, 1); continue;
        }

        // Va chạm Đạn với Player
        let bulletHitPlayer = false;
        for (let id in players) {
            let p = players[id];
            if (id !== b.owner && !p.dead && p.hp > 0) {
                const dx = b.x - (p.x + PLAYER_SIZE/2);
                const dy = b.y - (p.y + PLAYER_SIZE/2);
                
                if ((dx * dx + dy * dy) < HIT_RADIUS_SQ) {
                    p.hp -= 10;
                    bulletHitPlayer = true;
                    io.to(id).emit('hit');
                    
                    if (p.hp <= 0) {
                        handlePlayerDeath(p, b.owner);
                    }
                    break;
                }
            }
        }
        if (bulletHitPlayer) bullets.splice(i, 1);
    }

    // Nén Data gửi về Client
    let minPlayers = {};
    for (let id in players) {
        let p = players[id];
        minPlayers[id] = {
            ...p,
            x: Math.round(p.x),
            y: Math.round(p.y),
            moving: undefined 
        };
    }
    
    let minBullets = bullets.map(b => ({ x: Math.round(b.x), y: Math.round(b.y) }));
    let minItems = items.map(it => ({ x: Math.round(it.x), y: Math.round(it.y), type: it.type }));
    let minBombs = bombs.map(b => ({ x: Math.round(b.x), y: Math.round(b.y) }));

    io.emit('state', { players: minPlayers, bullets: minBullets, items: minItems, bombs: minBombs });

}, 1000 / 60);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log('Server running on port ' + PORT); });