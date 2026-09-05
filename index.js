const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, AttachmentBuilder, PermissionsBitField } = require('discord.js');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { QuickDB } = require('quick.db');
const https = require('https');

const db = new QuickDB({ filePath: './database.sqlite' });

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ] 
});

const TOKEN = process.env.TOKEN;

// ---------------- [ 기본 설정 ] ----------------
const GUILD_ID = '1456729030459134115'; 
const PURCHASE_LOG_CHANNEL_ID = '1457384858065047663'; 
// ------------------------------------------------

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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 랭킹 구하기 함수 (동점 시 가입일 순)
async function getUserRank(guild, targetUserId) {
    try {
        const allEntries = await db.all();
        const userMap = new Map();

        for (const entry of allEntries) {
            const key = entry.id || entry.key || '';
            if (typeof key === 'string' && key.startsWith('user_')) {
                const uid = key.split('.')[0].replace('user_', '');
                if (uid && !userMap.has(uid)) {
                    userMap.set(uid, true);
                }
            }
        }

        if (!userMap.has(targetUserId)) {
            userMap.set(targetUserId, true);
        }

        const fetchPromises = Array.from(userMap.keys()).map(async (uid) => {
            try {
                const member = await guild.members.fetch(uid).catch(() => null);
                if (!member || member.user.bot) return null;

                const amount = await db.get(`user_${uid}.totalAmount`);
                const count = await db.get(`user_${uid}.buyCount`);

                return {
                    id: uid,
                    user: member.user,
                    amount: Number(amount) || 0,
                    count: Number(count) || 0,
                    joinedAt: member.joinedTimestamp || Date.now()
                };
            } catch (e) {
                return null;
            }
        });

        const results = await Promise.all(fetchPromises);
        const validUsers = results.filter(u => u !== null);

        validUsers.sort((a, b) => {
            if (b.amount !== a.amount) {
                return b.amount - a.amount;
            }
            return a.joinedAt - b.joinedAt;
        });

        const rankIndex = validUsers.findIndex(u => u.id === targetUserId);
        return rankIndex !== -1 ? `#${rankIndex + 1}` : '#1';
    } catch (e) {
        console.error('랭킹 집계 오류:', e);
        return '#1';
    }
}

client.once('ready', async () => {
    await loadOnlineFont();
    console.log(`봇 접속 성공: ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName('지급완료')
            .setDescription('지급 완료 알림 및 구매 로그를 전송합니다.')
            .addStringOption(opt => opt.setName('금액').setDescription('구매 금액').setRequired(true))
            .addStringOption(opt => opt.setName('상품').setDescription('구매한 상품명').setRequired(true))
            .addStringOption(opt => opt.setName('수량').setDescription('구매 수량').setRequired(true))
            .addUserOption(opt => opt.setName('구매자').setDescription('구매한 유저').setRequired(false))
            .addUserOption(opt => opt.setName('판매자').setDescription('담당 판매자').setRequired(false))
    ];

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    try {
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, GUILD_ID),
            { body: commands }
        );
        console.log('[/지급완료] 슬래시 명령어 등록 완료!');
    } catch (error) {
        console.error('슬래시 명령어 등록 오류:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === '지급완료') {
        await interaction.reply({ content: '처리를 시작합니다.', ephemeral: true });

        const itemName = interaction.options.getString('상품');
        const itemQty = interaction.options.getString('수량');
        const amountStr = interaction.options.getString('금액');
        const numericAmount = parseInt(amountStr.replace(/[^0-9]/g, '')) || 0;

        const buyer = interaction.options.getUser('구매자') || interaction.user;
        const seller = interaction.options.getUser('판매자') || interaction.user;

        const currentAmount = (await db.get(`user_${buyer.id}.totalAmount`)) || 0;
        const currentCount = (await db.get(`user_${buyer.id}.buyCount`)) || 0;

        await db.set(`user_${buyer.id}.totalAmount`, Number(currentAmount) + numericAmount);
        await db.set(`user_${buyer.id}.buyCount`, Number(currentCount) + 1);

        const currentBiggest = (await db.get(`user_${buyer.id}.biggestDeal`)) || 0;
        if (numericAmount > currentBiggest) {
            await db.set(`user_${buyer.id}.biggestDeal`, numericAmount);
        }

        try {
            const logChannel = await client.channels.fetch(PURCHASE_LOG_CHANNEL_ID);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor(0xFFD1DC)
                    .setDescription(`°.✩┈┈∘┈˃̶ ୨<a:Pinkheartgif:1545408138377695352> ୧˂̶┈∘┈┈✩.°\n\n${buyer}, ${itemName} (${itemQty}개) 구매 감사합니다 .ᐟ.ᐟ\n\n사용된 금액 : ${amountStr}\n\n해당 관리 판매자: ${seller}\n\n°.✩┈┈∘┈˃̶ ୨<a:Pinkheartgif:1545408138377695352> ୧˂̶┈∘┈┈✩.°\n࣪𓏲ּ ᥫ᭡ ₊ 𝑻𝒉𝒂𝒏𝒌 𝒚𝒐𝒖 ⊹ ˑ ִֶ 𓂃`)
                    .setImage('https://i.imgur.com/jokl6LQ.gif');

                await logChannel.send({ content: `${buyer}`, embeds: [logEmbed] });
            }
        } catch (error) {
            console.error("구매 로그 채널 오류:", error);
        }

        const ticketEmbed = new EmbedBuilder()
            .setColor(0xFFD1DC)
            .setDescription(`**아이템이 정상적으로 지급되었어요.** <a:veryheart:1479957265871143104>\nhttps://discord.com/channels/1456729030459134115/1457384179535712473 작성은 필수입니다`);

        await interaction.channel.send({ content: `${buyer}`, embeds: [ticketEmbed] });
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith('$')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift();

    if (command === '유저정보변경로그') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ 이 명령어를 사용할 수 있는 권한이 없습니다. (관리자 전용)');
        }

        const channelId = args[0];
        if (!channelId) {
            return message.reply('❌ 설정할 채널 ID를 입력해주세요. 예: `$유저정보변경로그 1545759434175815771`');
        }

        try {
            const targetChannel = await client.channels.fetch(channelId);
            if (!targetChannel) throw new Error();

            await db.set('info_log_channel_id', channelId);
            return message.reply(`✅ 유저 정보 변경 로그 채널이 <#${channelId}> 로 설정되었습니다.`);
        } catch (e) {
            return message.reply('❌ 올바르지 않은 채널 ID이거나 접근 권한이 없습니다.');
        }
    }

    if (command === '유저구매횟수') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ 이 명령어를 사용할 수 있는 권한이 없습니다. (관리자 전용)');
        }

        const count = parseInt(args[0]);
        const targetUser = message.mentions.users.first() || (args[1] ? await client.users.fetch(args[1]).catch(() => null) : null);

        if (isNaN(count) || !targetUser) {
            return message.reply('❌ 사용법: `$유저구매횟수 (변경할 횟수) (@유저멘션 또는 유저ID)`');
        }

        await db.set(`user_${targetUser.id}.buyCount`, count);

        await message.reply(`✅ ${targetUser.username} 님의 구매 횟수가 **${count}회**로 변경되었습니다.`);

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
                            { name: '변경 후 총 구매 횟수', value: `${count}회`, inline: false }
                        )
                        .setTimestamp();

                    await infoLogChannel.send({ embeds: [infoEmbed] });
                }
            } catch (error) {
                console.error('로그 전송 실패:', error);
            }
        }
    }

    if (command === '유저구매금액') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ 이 명령어를 사용할 수 있는 권한이 없습니다. (관리자 전용)');
        }

        const amount = parseInt(args[0]);
        const targetUser = message.mentions.users.first() || (args[1] ? await client.users.fetch(args[1]).catch(() => null) : null);

        if (isNaN(amount) || !targetUser) {
            return message.reply('❌ 사용법: `$유저구매금액 (변경할 금액) (@유저멘션 또는 유저ID)`');
        }

        await db.set(`user_${targetUser.id}.totalAmount`, amount);

        const currentBiggest = (await db.get(`user_${targetUser.id}.biggestDeal`)) || 0;
        if (amount > currentBiggest) {
            await db.set(`user_${targetUser.id}.biggestDeal`, amount);
        }

        await message.reply(`✅ ${targetUser.username} 님의 누적 금액이 **₩${amount.toLocaleString()}**으로 변경되었습니다.`);

        const infoLogChannelId = await db.get('info_log_channel_id');
        if (infoLogChannelId) {
            try {
                const infoLogChannel = await client.channels.fetch(infoLogChannelId);
                if (infoLogChannel) {
                    const infoEmbed = new EmbedBuilder()
                        .setColor(0x3498DB)
                        .setTitle('🛠️ 유저 정보 변경 알림 (구매 금액)')
                        .addFields(
                            { name: '처리 관리자', value: `${message.author} (${message.author.tag})`, inline: true },
                            { name: '대상 유저', value: `${targetUser} (${targetUser.tag})`, inline: true },
                            { name: '변경 후 총 누적 금액', value: `₩${amount.toLocaleString()}`, inline: false }
                        )
                        .setTimestamp();

                    await infoLogChannel.send({ embeds: [infoEmbed] });
                }
            } catch (error) {
                console.error('로그 전송 실패:', error);
            }
        }
    }

    if (command === '유저최대금액') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ 이 명령어를 사용할 수 있는 권한이 없습니다. (관리자 전용)');
        }

        const amount = parseInt(args[0]);
        const targetUser = message.mentions.users.first() || (args[1] ? await client.users.fetch(args[1]).catch(() => null) : null);

        if (isNaN(amount) || !targetUser) {
            return message.reply('❌ 사용법: `$유저최대금액 (변경할 금액) (@유저멘션 또는 유저ID)`');
        }

        await db.set(`user_${targetUser.id}.biggestDeal`, amount);

        await message.reply(`✅ ${targetUser.username} 님의 최대 거래 금액(BIGGEST DEAL)이 **₩${amount.toLocaleString()}**으로 변경되었습니다.`);

        const infoLogChannelId = await db.get('info_log_channel_id');
        if (infoLogChannelId) {
            try {
                const infoLogChannel = await client.channels.fetch(infoLogChannelId);
                if (infoLogChannel) {
                    const infoEmbed = new EmbedBuilder()
                        .setColor(0x9B59B6)
                        .setTitle('🛠️ 유저 정보 변경 알림 (최대 거래 금액)')
                        .addFields(
                            { name: '처리 관리자', value: `${message.author} (${message.author.tag})`, inline: true },
                            { name: '대상 유저', value: `${targetUser} (${targetUser.tag})`, inline: true },
                            { name: '변경 후 최대 거래 금액', value: `₩${amount.toLocaleString()}`, inline: false }
                        )
                        .setTimestamp();

                    await infoLogChannel.send({ embeds: [infoEmbed] });
                }
            } catch (error) {
                console.error('로그 전송 실패:', error);
            }
        }
    }

    if (command === '구매랭크') {
        const loadingMsg = await message.reply('구매 금액을 조회하는 중이에요. . .');

        try {
            const allEntries = await db.all();
            const userMap = new Map();

            for (const entry of allEntries) {
                const key = entry.id || entry.key || '';
                if (typeof key === 'string' && key.startsWith('user_')) {
                    const uid = key.split('.')[0].replace('user_', '');
                    if (uid && !userMap.has(uid)) {
                        userMap.set(uid, true);
                    }
                }
            }

            const fetchPromises = Array.from(userMap.keys()).map(async (uid) => {
                const member = await message.guild.members.fetch(uid).catch(() => null);
                if (!member || member.user.bot) return null;

                const amount = (await db.get(`user_${uid}.totalAmount`)) || 0;
                return {
                    user: member.user,
                    amount: Number(amount),
                    joinedAt: member.joinedTimestamp || Date.now()
                };
            });

            const rankResults = await Promise.all(fetchPromises);
            const rankData = rankResults.filter(item => item !== null);

            rankData.sort((a, b) => {
                if (b.amount !== a.amount) {
                    return b.amount - a.amount;
                }
                return a.joinedAt - b.joinedAt;
            });

            const top20 = rankData.slice(0, 20);

            const itemHeight = 65;
            const rows = Math.min(top20.length, 10);
            const canvasWidth = 900;
            const canvasHeight = Math.max(220 + rows * itemHeight, 350);

            const canvas = createCanvas(canvasWidth, canvasHeight);
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = '#0F0F12';
            ctx.beginPath();
            ctx.roundRect(0, 0, canvasWidth, canvasHeight, 20);
            ctx.fill();

            ctx.fillStyle = '#FFFFFF';
            ctx.font = '32px CustomFont';
            ctx.fillText('🏆 TOP 20 PURCHASE RANKING', 40, 65);

            ctx.fillStyle = '#72767D';
            ctx.font = '14px CustomFont';
            ctx.fillText('Data sorted by total purchase volume (Tier: Joined Date)', 40, 95);

            ctx.strokeStyle = '#27272E';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(40, 115);
            ctx.lineTo(canvasWidth - 40, 115);
            ctx.stroke();

            const avatarImages = await Promise.all(
                top20.map(item => loadImage(item.user.displayAvatarURL({ extension: 'png', size: 64 })).catch(() => null))
            );

            for (let i = 0; i < top20.length; i++) {
                const item = top20[i];
                const isSecondCol = i >= 10;
                const colIndex = isSecondCol ? 1 : 0;
                const rowIndex = isSecondCol ? i - 10 : i;

                const startX = colIndex === 0 ? 40 : 470;
                const startY = 140 + rowIndex * itemHeight;

                ctx.fillStyle = '#18181C';
                ctx.beginPath();
                ctx.roundRect(startX, startY, 390, 55, 12);
                ctx.fill();

                ctx.font = '20px CustomFont';
                if (i === 0) ctx.fillStyle = '#FFD700';
                else if (i === 1) ctx.fillStyle = '#C0C0C0';
                else if (i === 2) ctx.fillStyle = '#CD7F32';
                else ctx.fillStyle = '#8E9297';

                ctx.fillText(`#${i + 1}`, startX + 15, startY + 34);

                const avatarImg = avatarImages[i];
                if (avatarImg) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(startX + 80, startY + 27.5, 18, 0, Math.PI * 2, true);
                    ctx.closePath();
                    ctx.clip();
                    ctx.drawImage(avatarImg, startX + 62, startY + 9.5, 36, 36);
                    ctx.restore();
                }

                ctx.fillStyle = '#FFFFFF';
                ctx.font = '16px CustomFont';
                let username = item.user.username;
                if (username.length > 9) username = username.substring(0, 8) + '..';
                ctx.fillText(username, startX + 110, startY + 33);

                ctx.fillStyle = '#2ECC71';
                ctx.font = '16px CustomFont';
                const amountText = `₩${item.amount.toLocaleString()}`;
                const textWidth = ctx.measureText(amountText).width;
                ctx.fillText(amountText, startX + 375 - textWidth, startY + 33);
            }

            const attachment = new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'ranking.png' });

            await sleep(1000);
            await loadingMsg.delete().catch(() => {});
            await message.reply({ files: [attachment] });

        } catch (error) {
            console.error('구매랭크 이미지 생성 오류:', error);
            await loadingMsg.delete().catch(() => {});
            await message.reply('❌ 랭킹 이미지 생성 중 오류가 발생했습니다.');
        }
    }

    if (command === '정보') {
        const loadingMsg = await message.reply('유저 정보를 불러오는 중이에요. . .');

        try {
            const targetUser = message.mentions.users.first() || message.author;
            
            const [targetMember, totalAmount, buyCount, biggestDeal, userRank, avatar] = await Promise.all([
                message.guild.members.fetch(targetUser.id).catch(() => null),
                db.get(`user_${targetUser.id}.totalAmount`),
                db.get(`user_${targetUser.id}.buyCount`),
                db.get(`user_${targetUser.id}.biggestDeal`),
                getUserRank(message.guild, targetUser.id),
                loadImage(targetUser.displayAvatarURL({ extension: 'png', size: 128 })).catch(() => null)
            ]);

            const joinedAt = targetMember?.joinedAt 
                ? targetMember.joinedAt.toISOString().split('T')[0] 
                : '2026.09.06';

            const canvas = createCanvas(800, 420);
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = '#0F0F12';
            ctx.beginPath();
            ctx.roundRect(0, 0, 800, 420, 20);
            ctx.fill();

            if (avatar) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(90, 85, 45, 0, Math.PI * 2, true);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(avatar, 45, 40, 90, 90);
                ctx.restore();
            }

            ctx.fillStyle = '#FFFFFF';
            ctx.font = '30px CustomFont';
            ctx.fillText(`${targetUser.username}`, 160, 95);

            ctx.fillStyle = '#72767D';
            ctx.font = '14px CustomFont';
            ctx.fillText(`JOINED: ${joinedAt}`, 600, 80);

            ctx.fillStyle = '#18181C';
            ctx.beginPath();
            ctx.roundRect(40, 160, 350, 170, 15);
            ctx.fill();

            ctx.fillStyle = '#8E9297';
            ctx.font = '14px CustomFont';
            ctx.fillText('TOTAL VOLUME', 65, 195);

            ctx.fillStyle = '#FFFFFF';
            ctx.font = '32px CustomFont';
            ctx.fillText(`₩${Number(totalAmount || 0).toLocaleString()}`, 65, 245);

            ctx.fillStyle = '#8E9297';
            ctx.font = '13px CustomFont';
            ctx.fillText('BIGGEST DEAL', 65, 288);

            ctx.fillStyle = '#FFFFFF';
            ctx.font = '16px CustomFont';
            ctx.fillText(`₩${Number(biggestDeal || 0).toLocaleString()}`, 65, 312);

            ctx.fillStyle = '#18181C';
            ctx.beginPath();
            ctx.roundRect(410, 160, 350, 170, 15);
            ctx.fill();

            ctx.fillStyle = '#8E9297';
            ctx.font = '14px CustomFont';
            ctx.fillText('TOTAL DEALS', 435, 195);

            ctx.fillStyle = '#2ECC71';
            ctx.font = '32px CustomFont';
            ctx.fillText(`${buyCount || 0}`, 435, 245);

            ctx.fillStyle = '#8E9297';
            ctx.font = '13px CustomFont';
            ctx.fillText('RANK', 435, 288);

            ctx.fillStyle = '#E5A93C';
            ctx.font = '18px CustomFont';
            ctx.fillText(`${userRank}`, 435, 312);

            ctx.fillStyle = '#EE4B2B';
            ctx.font = '12px CustomFont';
            ctx.fillText('* Data recorded starting from 2026.09.06', 40, 370);

            const attachment = new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'profile.png' });

            await sleep(1000);

            await loadingMsg.delete().catch(() => {});
            await message.reply({ files: [attachment] });

        } catch (error) {
            console.error('정보 이미지 생성 오류:', error);
            await loadingMsg.delete().catch(() => {});
            await message.reply('❌ 정보 조회 중 오류가 발생했습니다.');
        }
    }
});

client.login(TOKEN);
