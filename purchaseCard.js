// 구매 감사 카드 이미지 생성 (@napi-rs/canvas)
// - 폰트: fonts/NotoSansKR-Regular.otf, fonts/NotoSansKR-Bold.otf (같이 배포해야 한글이 안 깨져요)
// - 로블록스 아바타(상반신)는 필수로 들어갑니다.
 
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
 
const W = 1500;
const H = 650;
const PINK = '#ffa8c4';
const PINK_STRONG = '#ff8fb5';
const MUTED = '#9a949e';
 
const KIND_LABEL = { robux: '로벅스', ingame: '인게임 상품', etc: '기타' };
 
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
 
// ==================== 폰트 ====================
function findFonts() {
    const found = [];
    const skip = new Set(['node_modules', '.git']);
    (function walk(dir, depth) {
        if (depth > 3) return;
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (e) {
            return;
        }
        for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (!skip.has(e.name)) walk(p, depth + 1);
            } else if (/\.(otf|ttf)$/i.test(e.name)) {
                found.push(p);
            }
        }
    })(__dirname, 0);
    return found;
}
 
let fontsReady = false;
function ensureFonts() {
    if (fontsReady) return;
    const files = findFonts();
    const pick = (kw) => files.find((f) => path.basename(f).toLowerCase().includes(kw)) || files[0];
    const reg = pick('regular');
    const bold = pick('bold');
    if (!reg || !bold) {
        throw new Error('한글 폰트 파일(.otf/.ttf)을 찾을 수 없습니다. fonts 폴더를 같이 올렸는지 확인하세요.');
    }
    if (!GlobalFonts.registerFromPath(reg, 'NSK') || !GlobalFonts.registerFromPath(bold, 'NSKB')) {
        throw new Error(`폰트를 불러오지 못했습니다: ${reg} / ${bold}`);
    }
    fontsReady = true;
}
 
// ==================== 텍스트 유틸 ====================
// 폰트에 없는 이모지/특수문자 제거 (네모 깨짐 방지)
const BAD_RANGES = [
    [0x10000, 0x10ffff],
    [0x200b, 0x200f],
    [0x202a, 0x202e],
    [0x2060, 0x206f],
    [0xfe00, 0xfe0f],
    [0x2600, 0x27bf],
    [0x2b00, 0x2bff],
];
const BAD_RE = new RegExp(
    '[' + BAD_RANGES.map(([a, b]) => String.fromCodePoint(a) + '-' + String.fromCodePoint(b)).join('') + ']',
    'gu'
);
 
function clean(s, fallback = '') {
    const t = String(s ?? '').replace(BAD_RE, '').replace(/\s+/g, ' ').trim();
    return t || fallback;
}
 
function numLike(s) {
    const t = String(s ?? '').replace(/[,\s]/g, '');
    return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}
 
function formatCount(count, isRobux) {
    const n = numLike(count);
    if (n === null) return clean(count, '-');
    return isRobux ? `${n.toLocaleString('en-US')} R$` : `${n.toLocaleString('en-US')}개`;
}
 
function formatPrice(price) {
    const stripped = String(price ?? '').replace(/[,\s]/g, '').replace(/원$/, '');
    const n = numLike(stripped);
    if (n === null) return clean(price, '-');
    return `${n.toLocaleString('ko-KR')}원`;
}
 
// 구매 요약 문구 ("로벅스 700" / "아이템명 3개")
function buildSummary(kind, item, count) {
    if (kind === 'robux') {
        const n = numLike(count);
        return `로벅스 ${n === null ? clean(count, '') : n.toLocaleString('en-US')}`.trim();
    }
    return `${clean(item, '상품')} ${formatCount(count, false)}`.trim();
}
 
function kstNowString() {
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}. ${p(d.getUTCMonth() + 1)}. ${p(d.getUTCDate())}. ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
 
// 너비에 맞게 글자 크기를 줄이고, 그래도 넘치면 말줄임표
function fit(ctx, text, family, maxSize, minSize, maxWidth) {
    for (let s = maxSize; s >= minSize; s -= 2) {
        ctx.font = `${s}px ${family}`;
        if (ctx.measureText(text).width <= maxWidth) return { text, size: s };
    }
    ctx.font = `${minSize}px ${family}`;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return { text: t + '…', size: minSize };
}
 
// 띄어쓰기 단위로 최대 2줄까지 줄바꿈 (넘치면 마지막 줄 말줄임표). ctx.font는 미리 설정해 둘 것.
function wrapTwoLines(ctx, text, maxW) {
    const words = String(text).split(' ').filter(Boolean);
    const lines = [];
    let cur = '';
    let overflow = false;
    const pushWord = (w) => {
        const trial = cur ? `${cur} ${w}` : w;
        if (ctx.measureText(trial).width <= maxW) {
            cur = trial;
            return;
        }
        if (cur) {
            lines.push(cur);
            cur = '';
        }
        // 단어 하나가 너무 길면 글자 단위로 쪼갬
        for (const ch of Array.from(w)) {
            if (ctx.measureText(cur + ch).width > maxW && cur) {
                lines.push(cur);
                cur = ch;
            } else {
                cur += ch;
            }
        }
    };
    for (const w of words) {
        pushWord(w);
        if (lines.length >= 2) {
            overflow = true;
            break;
        }
    }
    if (lines.length < 2 && cur) lines.push(cur);
    else if (lines.length >= 2) overflow = true;
 
    const out = lines.slice(0, 2);
    const consumed = out.join(' ');
    if (overflow || consumed.replace(/ /g, '') !== String(text).replace(/ /g, '')) {
        let l2 = out[out.length - 1] || '';
        while (l2.length > 1 && ctx.measureText(l2 + '…').width > maxW) l2 = l2.slice(0, -1);
        out[out.length - 1] = l2 + '…';
    }
    return out;
}
 
// ==================== 로블록스 / 이미지 ====================
async function fetchBuffer(url, ms = 10000) {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}
 
// 로블 닉네임 -> { status: 'ok' | 'notfound' | 'error', id, name }
async function lookupRobloxUser(username) {
    try {
        const res = await fetch('https://users.roblox.com/v1/usernames/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return { status: 'error' };
        const json = await res.json();
        const u = json.data && json.data[0];
        if (!u) return { status: 'notfound' };
        return { status: 'ok', id: u.id, name: u.name };
    } catch (e) {
        console.error('로블록스 유저 조회 오류:', e);
        return { status: 'error' };
    }
}
 
// 로블록스 아바타(상반신) 이미지 Buffer (실패 시 null)
async function fetchRobloxAvatar(userId) {
    for (let i = 0; i < 4; i++) {
        try {
            const res = await fetch(
                `https://thumbnails.roblox.com/v1/users/avatar-bust?userIds=${userId}&size=420x420&format=Png&isCircular=false`,
                { signal: AbortSignal.timeout(8000) }
            );
            const json = await res.json();
            const d = json.data && json.data[0];
            if (d && d.state === 'Completed' && d.imageUrl) return await fetchBuffer(d.imageUrl);
        } catch (e) {
            console.error('로블록스 아바타 조회 오류:', e.message);
        }
        await sleep(800);
    }
    return null;
}
 
// ==================== 그리기 도구 ====================
function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
 
function glow(ctx, x, y, r, color) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(255,143,181,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
 
function drawCircleImage(ctx, img, cx, cy, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    if (img) {
        ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
    } else {
        ctx.fillStyle = '#3a1f2c';
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    ctx.restore();
}
 
function setStroke(ctx, color, w = 3) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}
 
// ----- 간단한 선형 아이콘들 -----
function iconBag(ctx, cx, cy) {
    setStroke(ctx, PINK);
    rr(ctx, cx - 15, cy - 8, 30, 26, 7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy - 8, 9, Math.PI, 0);
    ctx.stroke();
}
function iconList(ctx, cx, cy) {
    setStroke(ctx, PINK);
    rr(ctx, cx - 15, cy - 19, 30, 38, 7);
    ctx.stroke();
    for (const dy of [-8, 0, 8]) {
        ctx.beginPath();
        ctx.moveTo(cx - 7, cy + dy);
        ctx.lineTo(cx + 7, cy + dy);
        ctx.stroke();
    }
}
function iconCoin(ctx, cx, cy, r = 17) {
    setStroke(ctx, PINK);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
    ctx.stroke();
}
function iconUser(ctx, cx, cy) {
    setStroke(ctx, PINK);
    ctx.beginPath();
    ctx.arc(cx, cy - 8, 8.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy + 19, 17, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
}
function iconCalendar(ctx, cx, cy) {
    setStroke(ctx, MUTED, 2.6);
    rr(ctx, cx - 17, cy - 14, 34, 32, 7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 17, cy - 4);
    ctx.lineTo(cx + 17, cy - 4);
    ctx.stroke();
    for (const dx of [-8, 8]) {
        ctx.beginPath();
        ctx.moveTo(cx + dx, cy - 20);
        ctx.lineTo(cx + dx, cy - 10);
        ctx.stroke();
    }
}
function iconInfo(ctx, cx, cy) {
    setStroke(ctx, PINK, 2.2);
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - 2);
    ctx.lineTo(cx, cy + 7);
    ctx.stroke();
    ctx.fillStyle = PINK;
    ctx.beginPath();
    ctx.arc(cx, cy - 7, 1.8, 0, Math.PI * 2);
    ctx.fill();
}
 
function drawSpaced(ctx, text, rightX, y, spacing) {
    const chars = Array.from(text);
    let total = 0;
    const widths = chars.map((c) => {
        const w = ctx.measureText(c).width;
        total += w + spacing;
        return w;
    });
    total -= spacing;
    let x = rightX - total;
    ctx.textAlign = 'left';
    chars.forEach((c, i) => {
        ctx.fillText(c, x, y);
        x += widths[i] + spacing;
    });
    return total;
}
 
// ==================== 카드 렌더링 ====================
/**
 * 세로형(정사각형에 가까운) 구매 감사 카드
 * o = {
 *   kind: 'robux' | 'ingame' | 'etc',
 *   buyerName, buyerAvatarBuf,      // 구매자 디스코드 아이디 / 프사 (작은 배지)
 *   robloxAvatarBuf,                // 로블록스 아바타(상반신) - 큰 원형
 *   item, count, price,
 *   sellerName, sellerAvatarBuf
 * }
 * (서버 이름/아이콘은 이제 임베드 푸터에 표시하므로 이미지에는 넣지 않아요)
 * 반환: PNG Buffer
 */
async function renderPurchaseCard(o) {
    ensureFonts();
 
    const PW = 1100;
    const PH = 1236;
    const isRobux = o.kind === 'robux';
    const kindLabel = KIND_LABEL[o.kind] || '기타';
    const buyerName = clean(o.buyerName, '구매자');
    const sellerName = clean(o.sellerName, '-');
    const summary = buildSummary(o.kind, o.item, o.count);
 
    const safeLoad = async (buf) => {
        if (!buf) return null;
        try {
            return await loadImage(buf);
        } catch (e) {
            return null;
        }
    };
    const [rbxImg, buyerImg, sellerImg] = await Promise.all([
        safeLoad(o.robloxAvatarBuf),
        safeLoad(o.buyerAvatarBuf),
        safeLoad(o.sellerAvatarBuf),
    ]);
 
    const canvas = createCanvas(PW, PH);
    const ctx = canvas.getContext('2d');
    let g;
    const cx = PW / 2;
 
    // ---------- 배경 ----------
    rr(ctx, 0, 0, PW, PH, 56);
    ctx.save();
    ctx.clip();
    g = ctx.createLinearGradient(0, 0, 0, PH);
    g.addColorStop(0, '#100e13');
    g.addColorStop(1, '#0a090c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, PW, PH);
    glow(ctx, PW - 100, 40, 560, 'rgba(255,143,181,0.14)');
    glow(ctx, 40, PH - 20, 480, 'rgba(255,143,181,0.08)');
    glow(ctx, cx, 300, 380, 'rgba(255,143,181,0.12)');
    ctx.restore();
 
    rr(ctx, 20, 20, PW - 40, PH - 40, 44);
    g = ctx.createLinearGradient(PW, 0, 0, PH);
    g.addColorStop(0, 'rgba(255,168,196,0.85)');
    g.addColorStop(0.5, 'rgba(255,168,196,0.25)');
    g.addColorStop(1, 'rgba(255,168,196,0.12)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 2;
    ctx.stroke();
 
    // ---------- 상단: 종류 태그 + 지급 일시 ----------
    ctx.font = '22px NSKB';
    const pillLabel = `${kindLabel} 구매`;
    const pillW = ctx.measureText(pillLabel).width + 40;
    rr(ctx, 60, 58, pillW, 38, 19);
    ctx.fillStyle = 'rgba(255,143,181,0.14)';
    ctx.fill();
    setStroke(ctx, 'rgba(255,143,181,0.55)', 1.5);
    ctx.stroke();
    ctx.fillStyle = PINK;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(pillLabel, 80, 78);
 
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
 
    // ---------- 로블록스 아바타 (큰 원형) ----------
    const cy = 300;
    const R = 140;
 
    g = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    g.addColorStop(0, '#4a2535');
    g.addColorStop(1, '#17111a');
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    if (rbxImg) ctx.drawImage(rbxImg, cx - R, cy - R, R * 2, R * 2);
    ctx.restore();
 
    ctx.beginPath();
    ctx.arc(cx, cy, R + 12, 0, Math.PI * 2);
    g = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    g.addColorStop(0, '#ffc0d6');
    g.addColorStop(1, '#ff8fb5');
    ctx.strokeStyle = g;
    ctx.lineWidth = 5;
    ctx.stroke();
 
    // 구매자 디스코드 프사 배지
    const bx = cx + 106;
    const by = cy + 110;
    const br = 38;
    ctx.beginPath();
    ctx.arc(bx, by, br + 9, 0, Math.PI * 2);
    ctx.fillStyle = '#0d0b0f';
    ctx.fill();
    drawCircleImage(ctx, buyerImg, bx, by, br);
    ctx.beginPath();
    ctx.arc(bx, by, br + 1, 0, Math.PI * 2);
    ctx.strokeStyle = PINK_STRONG;
    ctx.lineWidth = 3;
    ctx.stroke();
 
    // ---------- 이름 / 문구 (가운데 정렬) ----------
    ctx.textAlign = 'center';
 
    // 구매자 디스코드 아이디 (큰 그라데이션 글씨, 너무 길면 이름만 줄이고 " 님"은 유지)
    let nameFit = fit(ctx, `${buyerName} 님`, 'NSKB', 76, 40, 900);
    if (nameFit.text.endsWith('…')) {
        ctx.font = '40px NSKB';
        let n = buyerName;
        while (n.length > 1 && ctx.measureText(`${n}… 님`).width > 900) n = n.slice(0, -1);
        nameFit = { text: `${n}… 님`, size: 40 };
    }
    ctx.font = `${nameFit.size}px NSKB`;
    const nameW = ctx.measureText(nameFit.text).width;
    g = ctx.createLinearGradient(cx - nameW / 2, 0, cx + nameW / 2, 0);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#ffbfd6');
    ctx.fillStyle = g;
    ctx.fillText(nameFit.text, cx, 540);
 
    ctx.font = '34px NSK';
    ctx.fillStyle = MUTED;
    ctx.fillText('구매 감사합니다!', cx, 594);
 
    // 구매 요약 (코인 아이콘 + 핑크 강조)
    const sumFit = fit(ctx, `${summary} 구매`, 'NSKB', 42, 24, 820);
    ctx.font = `${sumFit.size}px NSKB`;
    const sumW = ctx.measureText(sumFit.text).width;
    const totalW = 36 + 14 + sumW;
    const sx0 = cx - totalW / 2;
    iconCoin(ctx, sx0 + 17, 640, 16);
    ctx.textAlign = 'left';
    ctx.fillStyle = PINK;
    ctx.fillText(sumFit.text, sx0 + 50, 654);
 
    // 구분선
    setStroke(ctx, 'rgba(255,255,255,0.08)', 1.5);
    ctx.beginPath();
    ctx.moveTo(60, 704);
    ctx.lineTo(PW - 60, 704);
    ctx.stroke();
 
    // ---------- 유리 카드 4개 (2x2) ----------
    const gap = 24;
    const cw = (PW - 120 - gap) / 2;
    const ch = 176;
    const startY = 736;
 
    const cards = [
        { icon: iconBag, label: '구매 상품', value: isRobux ? '로벅스' : clean(o.item, '-') },
        { icon: iconList, label: '구매 수량', value: formatCount(o.count, isRobux) },
        { icon: iconCoin, label: '사용 금액', value: formatPrice(o.price) },
        { icon: iconUser, label: '담당 판매자', value: sellerName, avatar: true },
    ];
 
    cards.forEach((c, i) => {
        const x = 60 + (i % 2) * (cw + gap);
        const y = startY + Math.floor(i / 2) * (ch + gap);
 
        rr(ctx, x, y, cw, ch, 28);
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        ctx.fill();
        ctx.save();
        rr(ctx, x, y, cw, ch, 28);
        ctx.clip();
        glow(ctx, x + cw, y + ch, 200, 'rgba(255,143,181,0.16)');
        ctx.restore();
        rr(ctx, x, y, cw, ch, 28);
        setStroke(ctx, 'rgba(255,168,196,0.24)', 1.5);
        ctx.stroke();
 
        c.icon(ctx, x + 52, y + 46);
        ctx.font = '28px NSK';
        ctx.fillStyle = '#d9d2db';
        ctx.fillText(c.label, x + 98, y + 56);
 
        setStroke(ctx, 'rgba(255,255,255,0.08)', 1.5);
        ctx.beginPath();
        ctx.moveTo(x + 36, y + 78);
        ctx.lineTo(x + cw - 36, y + 78);
        ctx.stroke();
 
        if (c.avatar) {
            drawCircleImage(ctx, sellerImg, x + 36 + 28, y + 126, 28);
            ctx.beginPath();
            ctx.arc(x + 36 + 28, y + 126, 29, 0, Math.PI * 2);
            setStroke(ctx, 'rgba(255,143,181,0.7)', 2);
            ctx.stroke();
            const vf = fit(ctx, c.value, 'NSKB', 42, 22, cw - 36 - 76 - 30);
            ctx.font = `${vf.size}px NSKB`;
            ctx.fillStyle = '#ffffff';
            ctx.fillText(vf.text, x + 36 + 74, y + 126 + vf.size * 0.35);
        } else {
            const maxW = cw - 72;
            const vf = fit(ctx, c.value, 'NSKB', 46, 30, maxW);
            ctx.fillStyle = '#ffffff';
            if (!vf.text.endsWith('…') || vf.text === c.value) {
                ctx.font = `${vf.size}px NSKB`;
                ctx.fillText(vf.text, x + 36, y + 142);
            } else {
                // 긴 상품명은 띄어쓰기 기준 2줄로 (넘치면 말줄임표)
                ctx.font = '30px NSKB';
                const lines = wrapTwoLines(ctx, c.value, maxW);
                ctx.fillText(lines[0], x + 36, y + 118);
                if (lines[1]) ctx.fillText(lines[1], x + 36, y + 156);
            }
        }
    });
 
    // ---------- 하단: 지급 일시 ----------
    const dateStr = kstNowString();
    ctx.font = '28px NSKB';
    const dW = ctx.measureText(dateStr).width;
    const dx0 = cx - (dW + 44) / 2;
    iconCalendar(ctx, dx0 + 14, 1176);
    ctx.fillStyle = '#cfc8d1';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(dateStr, dx0 + 44, 1176);
    ctx.textBaseline = 'alphabetic';
 
    return canvas.toBuffer('image/png');
}
 
// ==================== 계산기 카드 ====================
function fmtNum(n) {
    return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(n);
}
 
/**
 * o = {
 *   mode: 'price'  -> $가격  (rate: 만 원당 로벅스, amountIn: 구매할 로벅스 수량, result: 계산된 원화 가격)
 *         'robux'  -> $로벅스 (rate: 만 원당 로벅스, amountIn: 보낼 금액(원),     result: 계산된 로벅스 수량)
 *   guildName, guildIconBuf
 * }
 * 반환: PNG Buffer
 */
async function renderCalcCard(o) {
    ensureFonts();
 
    const CW = 1200;
    const CH = 566;
    const isPrice = o.mode === 'price';
    const guildName = clean(o.guildName, '');
    const guildImg = o.guildIconBuf ? await loadImage(o.guildIconBuf).catch(() => null) : null;
 
    const pillLabel = isPrice ? '로벅스 가격 계산' : '지급 로벅스 계산';
    const title = isPrice ? '로벅스 가격 결과' : '지급 로벅스 결과';
    const heroLabel = isPrice ? '계산된 로벅스 가격' : '계산된 로벅스 수량';
    const heroValue = isPrice ? `${fmtNum(o.result)}원` : `${fmtNum(o.result)} R$`;
    const sideCards = isPrice
        ? [
              ['만 원당 로벅스', fmtNum(o.rate)],
              ['구매할 로벅스 수량', `${fmtNum(o.amountIn)} R$`],
          ]
        : [
              ['만 원당 로벅스', fmtNum(o.rate)],
              ['보낼 금액', `${fmtNum(o.amountIn)}원`],
          ];
    const formula = isPrice ? '100원 단위 올림' : '소수점 버림';
 
    const canvas = createCanvas(CW, CH);
    const ctx = canvas.getContext('2d');
    let g;
 
    // ---------- 배경 ----------
    rr(ctx, 0, 0, CW, CH, 48);
    ctx.save();
    ctx.clip();
    g = ctx.createLinearGradient(0, 0, 0, CH);
    g.addColorStop(0, '#100e13');
    g.addColorStop(1, '#0a090c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CW, CH);
    glow(ctx, CW - 140, 30, 520, 'rgba(255,143,181,0.14)');
    glow(ctx, 40, CH - 10, 420, 'rgba(255,143,181,0.07)');
    ctx.restore();
 
    rr(ctx, 20, 20, CW - 40, CH - 40, 38);
    g = ctx.createLinearGradient(CW, 0, 0, CH);
    g.addColorStop(0, 'rgba(255,168,196,0.85)');
    g.addColorStop(0.5, 'rgba(255,168,196,0.25)');
    g.addColorStop(1, 'rgba(255,168,196,0.12)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 2;
    ctx.stroke();
 
    // ---------- 상단 ----------
    ctx.font = '22px NSKB';
    const pillW = ctx.measureText(pillLabel).width + 40;
    rr(ctx, 60, 56, pillW, 38, 19);
    ctx.fillStyle = 'rgba(255,143,181,0.14)';
    ctx.fill();
    setStroke(ctx, 'rgba(255,143,181,0.55)', 1.5);
    ctx.stroke();
    ctx.fillStyle = PINK;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(pillLabel, 80, 76);
    ctx.textBaseline = 'alphabetic';
 
    const rightEdge = CW - 60;
    if (guildName || guildImg) {
        let gw = 0;
        let gText = '';
        if (guildName) {
            const f = fit(ctx, guildName, 'NSKB', 24, 14, 300);
            gText = f.text;
            ctx.font = `${f.size}px NSKB`;
            gw = ctx.measureText(gText).width;
        }
        ctx.textBaseline = 'middle';
        if (gText) {
            ctx.fillStyle = '#e9e3ea';
            ctx.textAlign = 'right';
            ctx.fillText(gText, rightEdge, 76);
        }
        if (guildImg) {
            drawCircleImage(ctx, guildImg, rightEdge - gw - (gText ? 14 : 0) - 20, 76, 20);
        }
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
 
    // 타이틀 (그라데이션) + 서브
    ctx.font = '62px NSKB';
    const tW = ctx.measureText(title).width;
    g = ctx.createLinearGradient(60, 0, 60 + tW, 0);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#ffbfd6');
    ctx.fillStyle = g;
    ctx.fillText(title, 60, 174);
 
    ctx.font = '28px NSK';
    ctx.fillStyle = MUTED;
    ctx.fillText(`만 원당 ${fmtNum(o.rate)} 로벅스 기준`, 60, 220);
 
    // ---------- 메인 결과 카드 ----------
    const hx = 60;
    const hy = 256;
    const hw = 650;
    const hh = 214;
 
    rr(ctx, hx, hy, hw, hh, 30);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fill();
    ctx.save();
    rr(ctx, hx, hy, hw, hh, 30);
    ctx.clip();
    glow(ctx, hx + hw, hy + hh, 320, 'rgba(255,143,181,0.24)');
    ctx.restore();
    rr(ctx, hx, hy, hw, hh, 30);
    setStroke(ctx, 'rgba(255,168,196,0.45)', 1.8);
    ctx.stroke();
 
    iconCoin(ctx, hx + 52, hy + 52, 17);
    ctx.font = '28px NSK';
    ctx.fillStyle = '#d9d2db';
    ctx.fillText(heroLabel, hx + 98, hy + 62);
 
    setStroke(ctx, 'rgba(255,255,255,0.08)', 1.5);
    ctx.beginPath();
    ctx.moveTo(hx + 36, hy + 90);
    ctx.lineTo(hx + hw - 36, hy + 90);
    ctx.stroke();
 
    const hv = fit(ctx, heroValue, 'NSKB', 96, 44, hw - 72);
    ctx.font = `${hv.size}px NSKB`;
    const hvW = ctx.measureText(hv.text).width;
    g = ctx.createLinearGradient(hx + 36, 0, hx + 36 + hvW, 0);
    g.addColorStop(0, '#ffd3e2');
    g.addColorStop(1, '#ff8fb5');
    ctx.fillStyle = g;
    ctx.fillText(hv.text, hx + 36, hy + 176);
 
    // ---------- 우측 입력값 카드 2개 ----------
    const sx = 730;
    const sw = CW - 60 - sx;
    const sh = 97;
    sideCards.forEach(([label, value], i) => {
        const sy = hy + i * (sh + 20);
        rr(ctx, sx, sy, sw, sh, 24);
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        ctx.fill();
        ctx.save();
        rr(ctx, sx, sy, sw, sh, 24);
        ctx.clip();
        glow(ctx, sx + sw, sy + sh, 170, 'rgba(255,143,181,0.14)');
        ctx.restore();
        rr(ctx, sx, sy, sw, sh, 24);
        setStroke(ctx, 'rgba(255,168,196,0.24)', 1.5);
        ctx.stroke();
 
        ctx.font = '23px NSK';
        ctx.fillStyle = MUTED;
        ctx.fillText(label, sx + 32, sy + 36);
 
        const f = fit(ctx, value, 'NSKB', 40, 22, sw - 64);
        ctx.font = `${f.size}px NSKB`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(f.text, sx + 32, sy + 78);
    });
 
    // ---------- 푸터 (작은 안내 문구만) ----------
    const fy = CH - 52;
    ctx.font = '18px NSK';
    ctx.fillStyle = MUTED;
    ctx.fillText(formula, 64, fy + 6);
    const fW = ctx.measureText(formula).width;
 
    let rW = 0;
    if (guildName) {
        ctx.font = '18px NSK';
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        rW = drawSpaced(ctx, guildName.toUpperCase(), CW - 60, fy + 6, 5);
    }
    if (64 + fW + 32 < CW - 60 - rW - 32) {
        setStroke(ctx, 'rgba(255,168,196,0.25)', 1.5);
        ctx.beginPath();
        ctx.moveTo(64 + fW + 28, fy);
        ctx.lineTo(CW - 60 - rW - 28, fy);
        ctx.stroke();
    }
 
    return canvas.toBuffer('image/png');
}
 
module.exports = {
    renderCalcCard,
    renderPurchaseCard,
    buildSummary,
    lookupRobloxUser,
    fetchRobloxAvatar,
    fetchBuffer,
};
 
