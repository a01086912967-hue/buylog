const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { QuickDB } = require('quick.db');
const https = require('https');

const db = new QuickDB();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

const TOKEN = process.env.TOKEN;

// 온라인 폰트 로드 및 등록
function loadOnlineFont() {
    return new Promise((resolve) => {
        const fontUrl = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf';
        https.get(fontUrl, (res) => {
            const data = [];
            res.on('data', (chunk) => data.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(data);
                GlobalFonts.register(buffer, 'CustomFont');
                console.log('폰트 글로벌 등록 성공!');
                resolve();
            });
        }).on('error', (err) => {
            console.error('폰트 로드 실패:', err);
            resolve();
        });
    });
}

// 랭킹 정확도 개선 수정
async function getUserRank(userId) {
    const allData = await db.all();
    const userAmountMap = [];

    for (const item of allData) {
        if (item.id.startsWith('user_') && item.id.endsWith('.totalAmount')) {
            const uid = item.id.split('_')[1].replace('.totalAmount', '');
            const amount = Number(item.value) || 0;
            userAmountMap.push({ id: uid, amount });
        }
    }

    if (userAmountMap.length === 0) return '#-';

    userAmountMap.sort((a, b) => b.amount - a.amount);
    const rankIndex = userAmountMap.findIndex(u => u.id === userId);
    return rankIndex !== -1 ? `#${rankIndex + 1}` : '#-';
}

client.once('ready', async () => {
    await loadOnlineFont();
    console.log(`봇 준비 완료: ${client.user.tag}`);
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith('$')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift();

    // 1. $유저정보변경로그 (채널아이디)
    if (command === '유저정보변경로그') {
        const channelId = args[0];
        if (!channelId) {
            return message.reply('❌ 설정할 채널 ID를 입력해주세요. 예시: `$유저정보변경로그 1545759434175815771`');
        }

        try {
            const targetChannel = await client.channels.fetch(channelId);
            if (!targetChannel) throw new Error();

            await db.set('info_log_channel_id', channelId);
            return message.reply(`✅ 유저 정보 변경 로그 채널이 <#${channelId}> (으)로 설정되었습니다.`);
        } catch (e) {
            return message.reply('❌ 올바르지 않은 채널 ID이거나 봇이 접근할 수 없는 채널입니다.');
        }
    }

    // 2. $유저구매횟수 (추가할 값) (유저멘션)
    if (command === '유저구매횟수') {
        const count = parseInt(args[0]);
        const targetUser = message.mentions.users.first();

        if (isNaN(count) || !targetUser) {
            return message.reply('❌ 사용법: `$유저구매횟수 (추가할 횟수) (@유저멘션)`');
        }

        await db.add(`user_${targetUser.id}.buyCount`, count);
        const newCount = (await db.get(`user_${targetUser.id}.buyCount`)) || 0;

        await message.reply(`✅ ${targetUser.username} 님의 구매 횟수에 ${count}회가 추가되었습니다. (현재: ${newCount}회)`);

        // 로그 채널로 전송
        const infoLogChannelId = await db.get('info_log_channel_id');
        if (infoLogChannelId) {
            try {
                const infoLogChannel = await client.channels.fetch(infoLogChannelId);
                if (infoLogChannel) {
                    const infoEmbed = new EmbedBuilder()
                        .setColor(0x2ECC71)
                        .setTitle('🛠️ 유저 정보 변경 알림 (구매 횟수)')
                        .addFields(
                            { name: '처리 관리자', value: `${message.author} (${message.author.tag})`, inline: true },
                            { name: '대상 유저', value: `${targetUser} (${targetUser.tag})`, inline: true },
                            { name: '추가된 횟수', value: `${count}회`, inline: false },
                            { name: '총 구매 횟수', value: `${newCount}회`, inline: false }
                        )
                        .setTimestamp();

                    await infoLogChannel.send({ embeds: [infoEmbed] });
                }
            } catch (error) {
                console.error('로그 채널 전송 실패:', error);
            }
        }
    }

    // 3. $정보 (@유저멘션 - 선택)
    if (command === '정보') {
        const targetUser = message.mentions.users.first() || message.author;
        let targetMember;
        
        try {
            targetMember = await message.guild.members.fetch(targetUser.id);
        } catch (e) {
            targetMember = null;
        }

        const totalAmount = (await db.get(`user_${targetUser.id}.totalAmount`)) || 0;
        const buyCount = (await db.get(`user_${targetUser.id}.buyCount`)) || 0;
        const biggestDeal = (await db.get(`user_${targetUser.id}.biggestDeal`)) || 0;
        
        const userRank = await getUserRank(targetUser.id);

        const joinedAt = targetMember?.joinedAt 
            ? targetMember.joinedAt.toISOString().split('T')[0] 
            : '2026.09.06';

        const canvas = createCanvas(800, 420);
        const ctx = canvas.getContext('2d');

        // 메인 배경
        ctx.fillStyle = '#0F0F12';
        ctx.beginPath();
        ctx.roundRect(0, 0, 800, 420, 20);
        ctx.fill();

        // 아바타
        const avatarURL = targetUser.displayAvatarURL({ extension: 'png', size: 128 });
        try {
            const avatar = await loadImage(avatarURL);
            ctx.save();
            ctx.beginPath();
            ctx.arc(90, 85, 45, 0, Math.PI * 2, true);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(avatar, 45, 40, 90, 90);
            ctx.restore();
        } catch (e) { }

        // 유저명
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '30px CustomFont';
        ctx.fillText(`${targetUser.username}`, 160, 95);

        // 가입일
        ctx.fillStyle = '#72767D';
        ctx.font = '14px CustomFont';
        ctx.fillText(`JOINED: ${joinedAt}`, 600, 80);

        // TOTAL VOLUME
        ctx.fillStyle = '#18181C';
        ctx.beginPath();
        ctx.roundRect(40, 160, 350, 170, 15);
        ctx.fill();

        ctx.fillStyle = '#8E9297';
        ctx.font = '14px CustomFont';
        ctx.fillText('TOTAL VOLUME', 65, 195);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '32px CustomFont';
        ctx.fillText(`₩${Number(totalAmount).toLocaleString()}`, 65, 245);

        ctx.fillStyle = '#8E9297';
        ctx.font = '13px CustomFont';
        ctx.fillText('BIGGEST DEAL', 65, 288);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '16px CustomFont';
        ctx.fillText(`₩${Number(biggestDeal).toLocaleString()}`, 65, 312);

        // TOTAL DEALS & RANK
        ctx.fillStyle = '#18181C';
        ctx.beginPath();
        ctx.roundRect(410, 160, 350, 170, 15);
        ctx.fill();

        ctx.fillStyle = '#8E9297';
        ctx.font = '14px CustomFont';
        ctx.fillText('TOTAL DEALS', 435, 195);

        ctx.fillStyle = '#2ECC71';
        ctx.font = '32px CustomFont';
        ctx.fillText(`${buyCount}`, 435, 245);

        ctx.fillStyle = '#8E9297';
        ctx.font = '13px CustomFont';
        ctx.fillText('RANK', 435, 288);

        ctx.fillStyle = '#E5A93C';
        ctx.font = '18px CustomFont';
        ctx.fillText(`${userRank}`, 435, 312);

        // 하단 안내 문구
        ctx.fillStyle = '#EE4B2B';
        ctx.font = '12px CustomFont';
        ctx.fillText('* Data recorded starting from 2026.09.06', 40, 370);

        const attachment = new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'profile.png' });
        await message.reply({ files: [attachment] });
    }
});

client.login(TOKEN);
