// 유저 정보($정보) / 서버 통계($통계) / 구매 랭킹($랭킹) 카드 이미지 (하늘 구름 컨셉)
const { createCanvas } = require('@napi-rs/canvas');
const { helpers } = require('./purchaseCard');
const { ensureFonts, rr, glow, drawSky, drawCircleImage, setStroke, fit, clean, loadImage, MUTED } = helpers;
 
const NAVY = '#1d3a66';
const LABEL = '#4d6a8c';
const NOTE = '모든 통계는 10월 28일 이후 기준';
const SKY_C1 = '#7cc4ff';
const SKY_C2 = '#3d9bf5';
 
// ---------- 공통 도구 ----------
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
 
function ymd(ts) {
    const d = new Date(ts + 9 * 60 * 60 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}. ${p(d.getUTCMonth() + 1)}. ${p(d.getUTCDate())}.`;
}
 
function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
 
async function safeLoad(buf) {
    if (!buf) return null;
    try {
        return await loadImage(buf);
    } catch (e) {
        return null;
    }
}
 
// 카드 모서리 안쪽에만 색 번짐 그리기
function tintGlow(ctx, W, H, R, x, y, r, color) {
    ctx.save();
    rr(ctx, 0, 0, W, H, R);
    ctx.clip();
    glow(ctx, x, y, r, color);
    ctx.restore();
}
 
// 유리 느낌 카드
function glass(ctx, x, y, w, h, r, tintHex) {
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = 'rgba(255,255,255,0.66)';
    ctx.fill();
    if (tintHex) {
        ctx.save();
        rr(ctx, x, y, w, h, r);
        ctx.clip();
        glow(ctx, x + w, y + h, Math.max(w, h) * 0.7, hexA(tintHex, 0.2));
        ctx.restore();
    }
    rr(ctx, x, y, w, h, r);
    setStroke(ctx, 'rgba(120,180,240,0.55)', 2);
    ctx.stroke();
}
 
// 등급 뱃지. 폭을 반환
function pill(ctx, text, x, cy, grade, size) {
    ctx.font = `${size}px NSKB`;
    const w = ctx.measureText(text).width + size * 1.2;
    const h = size * 1.75;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, grade.c1);
    g.addColorStop(1, grade.c2);
    rr(ctx, x, cy - h / 2, w, h, h / 2);
    ctx.fillStyle = g;
    ctx.fill();
    rr(ctx, x, cy - h / 2, w, h, h / 2);
    setStroke(ctx, 'rgba(255,255,255,0.85)', 2);
    ctx.stroke();
    ctx.fillStyle = grade.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, cy + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    return w;
}
 
function note(ctx, W, H) {
    ctx.font = '21px NSK';
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(NOTE, W / 2, H - 44);
    ctx.textAlign = 'left';
}
 
function gradText(ctx, text, x, y, c1, c2) {
    const w = ctx.measureText(text).width;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fillText(text, x, y);
    return w;
}
 
// ---------- 아이콘 (색을 받는 선형 아이콘) ----------
const icons = {
    bag(ctx, cx, cy, c) {
        setStroke(ctx, c, 3);
        rr(ctx, cx - 14, cy - 7, 28, 24, 7);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy - 7, 8, Math.PI, 0);
        ctx.stroke();
    },
    coin(ctx, cx, cy, c) {
        setStroke(ctx, c, 3);
        ctx.beginPath();
        ctx.arc(cx, cy, 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 9, 0, Math.PI * 2);
        ctx.stroke();
    },
    trophy(ctx, cx, cy, c) {
        setStroke(ctx, c, 3);
        ctx.beginPath();
        ctx.moveTo(cx - 11, cy - 14);
        ctx.lineTo(cx + 11, cy - 14);
        ctx.lineTo(cx + 11, cy - 3);
        ctx.quadraticCurveTo(cx + 11, cy + 8, cx, cy + 8);
        ctx.quadraticCurveTo(cx - 11, cy + 8, cx - 11, cy - 3);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, cy + 8);
        ctx.lineTo(cx, cy + 16);
        ctx.moveTo(cx - 8, cy + 16);
        ctx.lineTo(cx + 8, cy + 16);
        ctx.stroke();
    },
    swap(ctx, cx, cy, c) {
        setStroke(ctx, c, 3);
        ctx.beginPath();
        ctx.moveTo(cx - 14, cy - 7);
        ctx.lineTo(cx + 13, cy - 7);
        ctx.moveTo(cx + 7, cy - 13);
        ctx.lineTo(cx + 13, cy - 7);
        ctx.lineTo(cx + 7, cy - 1);
        ctx.moveTo(cx + 14, cy + 9);
        ctx.lineTo(cx - 13, cy + 9);
        ctx.moveTo(cx - 7, cy + 3);
        ctx.lineTo(cx - 13, cy + 9);
        ctx.lineTo(cx - 7, cy + 15);
        ctx.stroke();
    },
    shield(ctx, cx, cy, c) {
        setStroke(ctx, c, 3);
        ctx.beginPath();
        ctx.moveTo(cx, cy - 17);
        ctx.lineTo(cx + 14, cy - 11);
        ctx.lineTo(cx + 14, cy + 1);
        ctx.quadraticCurveTo(cx + 14, cy + 12, cx, cy + 18);
        ctx.quadraticCurveTo(cx - 14, cy + 12, cx - 14, cy + 1);
        ctx.lineTo(cx - 14, cy - 11);
        ctx.closePath();
        ctx.stroke();
    },
    user(ctx, cx, cy, c) {
        setStroke(ctx, c, 3);
        ctx.beginPath();
        ctx.arc(cx, cy - 8, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy + 19, 16, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
    },
    calendar(ctx, cx, cy, c) {
        setStroke(ctx, c, 3);
        rr(ctx, cx - 16, cy - 13, 32, 30, 7);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - 16, cy - 3);
        ctx.lineTo(cx + 16, cy - 3);
        ctx.stroke();
        for (const dx of [-7, 7]) {
            ctx.beginPath();
            ctx.moveTo(cx + dx, cy - 19);
            ctx.lineTo(cx + dx, cy - 9);
            ctx.stroke();
        }
    },
    invite(ctx, cx, cy, c) {
        icons.user(ctx, cx - 5, cy, c);
        setStroke(ctx, c, 3);
        ctx.beginPath();
        ctx.moveTo(cx + 12, cy - 4);
        ctx.lineTo(cx + 12, cy + 8);
        ctx.moveTo(cx + 6, cy + 2);
        ctx.lineTo(cx + 18, cy + 2);
        ctx.stroke();
    },
};
 
// =====================================================
// 1) 유저 정보 카드
// o = {
//   name, avatarBuf, guildName,
//   grade: { tier, serverRole, color },     // roles.resolveGrade() 결과
//   robux, spent, count, rank, rankTotal,    // rank: null이면 "순위 없음"
//   joinedTs, invites
// }
// =====================================================
async function renderProfileCard(o) {
    ensureFonts();
    const W = 1200;
    const H = 760;
    const col = o.grade.color;
    const pillObj = o.grade.tier || o.grade.serverRole;
 
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    let g;
 
    drawSky(ctx, W, H, 56, 20, 44, 'wide');
    tintGlow(ctx, W, H, 56, 170, 150, 560, hexA(col.c1, 0.42));
 
    // 등급 색 테두리
    rr(ctx, 20, 20, W - 40, H - 40, 44);
    g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, col.c1);
    g.addColorStop(1, col.c2);
    ctx.strokeStyle = g;
    ctx.lineWidth = 4;
    ctx.stroke();
 
    // 프로필 사진
    const img = await safeLoad(o.avatarBuf);
    const cx = 170;
    const cy = 150;
    const R = 84;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 10, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    drawCircleImage(ctx, img, cx, cy, R);
    ctx.beginPath();
    ctx.arc(cx, cy, R + 8, 0, Math.PI * 2);
    g = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    g.addColorStop(0, col.c1);
    g.addColorStop(1, col.c2);
    ctx.strokeStyle = g;
    ctx.lineWidth = 8;
    ctx.stroke();
 
    // 이름 + 등급 뱃지 (이름 바로 옆)
    const name = clean(o.name, '유저');
    const nf = fit(ctx, name, 'NSKB', 66, 34, pillObj ? 560 : 800);
    ctx.font = `${nf.size}px NSKB`;
    const nameW = gradText(ctx, nf.text, 290, 148, NAVY, col.main);
    if (pillObj) pill(ctx, pillObj.name, 290 + nameW + 24, 148 - nf.size * 0.33, pillObj, 26);
 
    ctx.font = '24px NSK';
    ctx.fillStyle = MUTED;
    const gn = clean(o.guildName, '').toUpperCase();
    if (gn) ctx.fillText(gn, 292, 196);
 
    // 정보 행 8개 (2열 x 4행)
    const tier = o.grade.tier;
    const role = o.grade.serverRole;
    const left = [
        [icons.bag, '구매한 로벅스', `${fmt(o.robux)} R$`, null],
        [icons.coin, '총 구매 금액', `${fmt(o.spent)}원`, null],
        [icons.trophy, '랭킹', o.rank ? `${o.rank}위 / ${o.rankTotal}명` : '순위 없음', null],
        [icons.swap, '총 거래 횟수', `${fmt(o.count)}회`, null],
    ];
    const right = [
        [icons.shield, '구매 등급', tier ? tier.name : '없음', tier ? tier.main : null],
        [icons.user, '서버 역할', role ? role.name : '없음', role ? role.main : null],
        [icons.calendar, '서버 가입일', o.joinedTs ? ymd(o.joinedTs) : '-', null],
        [icons.invite, '초대한 사람 수', `${fmt(o.invites)}명`, null],
    ];
 
    const bw = 530;
    const bh = 88;
    const gapY = 18;
    const y0 = 270;
    [left, right].forEach((rows, ci) => {
        const x = 60 + ci * (bw + 20);
        rows.forEach(([icon, label, value, color], ri) => {
            const y = y0 + ri * (bh + gapY);
            glass(ctx, x, y, bw, bh, 28, col.c2);
            icon(ctx, x + 46, y + bh / 2, col.main);
 
            ctx.font = '26px NSK';
            ctx.fillStyle = LABEL;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillText(label, x + 86, y + bh / 2 + 1);
            const lw = ctx.measureText(label).width;
 
            const vf = fit(ctx, value, 'NSKB', 38, 20, bw - 86 - lw - 20 - 30);
            ctx.font = `${vf.size}px NSKB`;
            ctx.fillStyle = color || NAVY;
            ctx.textAlign = 'right';
            ctx.fillText(vf.text, x + bw - 30, y + bh / 2 + 2);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
        });
    });
 
    note(ctx, W, H);
    return canvas.toBuffer('image/png');
}
 
// =====================================================
// 2) 서버 통계 카드
// o = {
//   guildName,
//   periods: [ { label, sub, stats, topBuyerName, topInviterName }, ... ]  // 2개
// }
// stats = store.periodStats() 결과
// =====================================================
async function renderStatsCard(o) {
    ensureFonts();
    const W = 1200;
    const H = 800;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
 
    drawSky(ctx, W, H, 56, 20, 44, 'wide');
 
    ctx.font = '66px NSKB';
    gradText(ctx, '서버 통계', 60, 128, NAVY, SKY_C2);
    ctx.font = '24px NSK';
    ctx.fillStyle = MUTED;
    const gn = clean(o.guildName, '').toUpperCase();
    if (gn) ctx.fillText(gn, 62, 174);
 
    const pw = 528;
    const ph = 520;
    const py = 214;
    o.periods.slice(0, 2).forEach((p, i) => {
        const x = 60 + i * (pw + 24);
        glass(ctx, x, py, pw, ph, 36, SKY_C2);
 
        pill(ctx, p.label, x + 30, py + 52, { c1: SKY_C1, c2: SKY_C2, text: '#ffffff' }, 26);
        ctx.font = '21px NSK';
        ctx.fillStyle = MUTED;
        ctx.textAlign = 'right';
        ctx.fillText(p.sub, x + pw - 30, py + 60);
        ctx.textAlign = 'left';
 
        const s = p.stats;
        const rows = [
            ['로벅스 판매량', `${fmt(s.robux)} R$`],
            ['총 판매 금액', `${fmt(s.spent)}원`],
            ['거래 횟수', `${fmt(s.count)}회`],
            ['구매 1등', s.topBuyer ? `${clean(p.topBuyerName, '알 수 없음')} · ${fmt(s.topBuyer.spent)}원` : '기록 없음'],
            ['서버 가입량', `${fmt(s.joined)}명`],
            ['초대 1등', s.topInviter ? `${clean(p.topInviterName, '알 수 없음')} · ${fmt(s.topInviter.count)}명` : '기록 없음'],
        ];
        const rh = 68;
        const ry0 = py + 108;
        rows.forEach(([label, value], ri) => {
            const y = ry0 + ri * rh;
            if (ri > 0) {
                setStroke(ctx, 'rgba(70,130,210,0.18)', 1.5);
                ctx.beginPath();
                ctx.moveTo(x + 30, y);
                ctx.lineTo(x + pw - 30, y);
                ctx.stroke();
            }
            ctx.font = '25px NSK';
            ctx.fillStyle = LABEL;
            ctx.textBaseline = 'middle';
            ctx.fillText(label, x + 30, y + rh / 2 + 1);
            const lw = ctx.measureText(label).width;
            const vf = fit(ctx, value, 'NSKB', 34, 18, pw - 60 - lw - 24);
            ctx.font = `${vf.size}px NSKB`;
            ctx.fillStyle = NAVY;
            ctx.textAlign = 'right';
            ctx.fillText(vf.text, x + pw - 30, y + rh / 2 + 2);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
        });
    });
 
    note(ctx, W, H);
    return canvas.toBuffer('image/png');
}
 
// =====================================================
// 3) 구매 랭킹 카드
// o = {
//   guildName,
//   entries: [ { rank, name, avatarBuf, grade, spent, robux } ]   // 최대 10명
// }
// =====================================================
const MEDAL = {
    1: { c1: '#ffe27a', c2: '#f0a500', text: '#5a3b00' },
    2: { c1: '#eef2f8', c2: '#a3b1c6', text: '#33465e' },
    3: { c1: '#f3b98a', c2: '#c0722f', text: '#ffffff' },
};
 
async function renderRankCard(o) {
    ensureFonts();
    const W = 1200;
    const n = Math.max(1, o.entries.length);
    const rowH = 72;
    const gap = 12;
    const top = 222;
    const H = top + n * (rowH + gap) + 86;
 
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    drawSky(ctx, W, H, 56, 20, 44, 'wide');
 
    ctx.font = '66px NSKB';
    gradText(ctx, '구매 랭킹', 60, 128, NAVY, SKY_C2);
    ctx.font = '24px NSK';
    ctx.fillStyle = MUTED;
    const gn = clean(o.guildName, '').toUpperCase();
    ctx.fillText(`${gn ? gn + '  ·  ' : ''}구매 금액 기준 TOP ${o.entries.length || 10}`, 62, 174);
 
    if (!o.entries.length) {
        glass(ctx, 60, top, W - 120, rowH + 20, 28, SKY_C2);
        ctx.font = '30px NSK';
        ctx.fillStyle = LABEL;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('아직 구매 기록이 없어요', W / 2, top + (rowH + 20) / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        note(ctx, W, H);
        return canvas.toBuffer('image/png');
    }
 
    const imgs = await Promise.all(o.entries.map((e) => safeLoad(e.avatarBuf)));
 
    o.entries.forEach((e, i) => {
        const x = 60;
        const y = top + i * (rowH + gap);
        const w = W - 120;
        const medal = MEDAL[e.rank];
        glass(ctx, x, y, w, rowH, 26, medal ? medal.c2 : SKY_C2);
        if (medal) {
            rr(ctx, x, y, w, rowH, 26);
            setStroke(ctx, hexA(medal.c2, 0.75), 2.5);
            ctx.stroke();
        }
 
        // 순위 원
        const rcx = x + 50;
        const rcy = y + rowH / 2;
        ctx.beginPath();
        ctx.arc(rcx, rcy, 25, 0, Math.PI * 2);
        if (medal) {
            const mg = ctx.createLinearGradient(rcx - 25, rcy - 25, rcx + 25, rcy + 25);
            mg.addColorStop(0, medal.c1);
            mg.addColorStop(1, medal.c2);
            ctx.fillStyle = mg;
        } else {
            ctx.fillStyle = 'rgba(124,196,255,0.28)';
        }
        ctx.fill();
        ctx.font = '28px NSKB';
        ctx.fillStyle = medal ? medal.text : '#3d6ea8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(e.rank), rcx, rcy + 1);
 
        // 프사
        const ax = x + 118;
        drawCircleImage(ctx, imgs[i], ax, rcy, 26);
        ctx.beginPath();
        ctx.arc(ax, rcy, 27, 0, Math.PI * 2);
        const col = e.grade.color;
        const rg = ctx.createLinearGradient(ax - 26, rcy - 26, ax + 26, rcy + 26);
        rg.addColorStop(0, col.c1);
        rg.addColorStop(1, col.c2);
        ctx.strokeStyle = rg;
        ctx.lineWidth = 3.5;
        ctx.stroke();
 
        // 이름 + 등급 뱃지
        const nf = fit(ctx, clean(e.name, '알 수 없음'), 'NSKB', 32, 20, 320);
        ctx.font = `${nf.size}px NSKB`;
        ctx.fillStyle = NAVY;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(nf.text, x + 164, rcy + 1);
        const nw = ctx.measureText(nf.text).width;
        const po = e.grade.tier || e.grade.serverRole;
        if (po) pill(ctx, po.name, x + 164 + nw + 14, rcy, po, 19);
 
        // 로벅스 / 금액
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';
        ctx.font = '26px NSK';
        ctx.fillStyle = LABEL;
        ctx.fillText(`${fmt(e.robux)} R$`, x + w - 290, rcy + 1);
        ctx.font = '34px NSKB';
        ctx.fillStyle = NAVY;
        ctx.fillText(`${fmt(e.spent)}원`, x + w - 30, rcy + 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    });
 
    note(ctx, W, H);
    return canvas.toBuffer('image/png');
}
 
module.exports = { renderProfileCard, renderStatsCard, renderRankCard, ymd };
 
