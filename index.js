const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    SlashCommandBuilder,
    PermissionFlagsBits,
    REST,
    Routes,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    ChannelType,
    AttachmentBuilder
} = require('discord.js');
const {
    renderPurchaseCard,
    renderCalcCard,
    buildSummary,
    lookupRobloxUser,
    fetchRobloxAvatar,
    fetchBuffer
} = require('./purchaseCard');
 
// TOKEN 또는 DISCORD_TOKEN 환경변수 모두 인식
const store = require('./store');
const tickets = require('./tickets');
const community = require('./community');
const web = require('./web');
const { renderProfileCard, renderStatsCard, renderRankCard, ymd } = require('./infoCards');
const { SERVER_ROLES, resolveGrade } = require('./roles');
 
const BOT_TOKEN = (process.env.TOKEN || process.env.DISCORD_TOKEN || '').trim();
 
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});
 
// 기본 설정
const LOG_CHANNEL_ID = '1457384858065047663';
// 구매로그 임베드 하단에 표시할 가게 이름 (비워두면 서버 이름을 대문자로 사용)
const SHOP_NAME_OVERRIDE = 'SODDU SHOP';
const ROLE_ID = '1457383788236505299';
const CALCULATOR_ROLE_ID = '1456747541348749342';
const IMAGE_URL = 'https://i.imgur.com/jokl6LQ.gif';
const LIGHT_PINK_COLOR = 0xFFB6C1;
const SKY_COLOR = 0xA9D8FF; // 구매로그 임베드 색 (하늘색)
 
// 관리자 명령어를 쓸 수 있는 역할 (오너/관리자) - 서버 관리자 권한이 있어도 허용
const ADMIN_ROLE_IDS = SERVER_ROLES.slice(0, 3).map((r) => r.id);
function isAdmin(member) {
    return !!member && (
        member.permissions.has(PermissionFlagsBits.Administrator) ||
        ADMIN_ROLE_IDS.some((id) => member.roles.cache.has(id))
    );
}
 
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
 
// 서버 아이콘 이미지 (계산기 카드용, 실패 시 null)
async function getGuildIconBuf(guild) {
    try {
        const url = guild && guild.iconURL({ extension: 'png', size: 128 });
        return url ? await fetchBuffer(url) : null;
    } catch (e) {
        return null;
    }
}
 
// ==================== 초대 추적 ====================
// 서버 초대 링크 사용 횟수를 비교해서 누가 초대했는지 기록해요. (봇에 "서버 관리" 권한 필요)
const inviteCache = new Map(); // guildId -> Map(code -> { uses, inviterId })
 
async function snapshotInvites(guild) {
    const invs = await guild.invites.fetch();
    return new Map(invs.map((i) => [i.code, { uses: i.uses || 0, inviterId: i.inviter ? i.inviter.id : null }]));
}
 
async function refreshInvites(guild) {
    try {
        inviteCache.set(guild.id, await snapshotInvites(guild));
    } catch (e) {
        console.error('[초대] 초대 목록을 불러오지 못했어요 (봇에 "서버 관리" 권한이 필요해요):', e.message);
    }
}
 
client.on('inviteCreate', (invite) => {
    const guild = invite.guild && client.guilds.cache.get(invite.guild.id);
    if (guild) refreshInvites(guild);
});
 
client.on('guildMemberAdd', async (member) => {
    if (member.user.bot) return;
    let inviterId = null;
    try {
        const before = inviteCache.get(member.guild.id) || new Map();
        const now = await snapshotInvites(member.guild);
        let usedCode = null;
        for (const [code, v] of now) {
            if (v.uses > (before.has(code) ? before.get(code).uses : 0)) {
                usedCode = code;
                inviterId = v.inviterId;
                break;
            }
        }
        // 사용 횟수 제한이 있는 초대 링크는 마지막 사용 후 사라지므로, 사라진 링크를 사용한 것으로 판단
        if (!usedCode) {
            for (const [code, v] of before) {
                if (!now.has(code)) {
                    inviterId = v.inviterId;
                    break;
                }
            }
        }
        inviteCache.set(member.guild.id, now);
    } catch (e) {
        console.error('[초대] 초대한 사람을 확인하지 못했어요:', e.message);
    }
    if (inviterId === member.id) inviterId = null;
    store.recordJoin(member.id, inviterId);
    // 환영 메시지 / 자동 역할 (대시보드에서 설정)
    community.onJoin(member, inviterId).catch((e) => console.error('[환영] 처리 실패:', e.message));
});
 
client.once('ready', async () => {
    console.log(`[릴리웨이] 봇이 성공적으로 실행되었습니다: ${client.user.tag}`);
    for (const g of client.guilds.cache.values()) await refreshInvites(g);
 
    try {
        const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: [] }
        );
    } catch (error) {
        console.error('기존 명령어 삭제 중 오류 발생:', error);
    }
 
    // 예전 버전이 서버(길드) 전용으로 등록해 둔 명령어 정리 (/지급완료 중복 방지)
    for (const g of client.guilds.cache.values()) {
        try {
            await g.commands.set([]);
        } catch (error) {
            console.error('서버 전용 명령어 정리 중 오류 발생:', error.message);
        }
    }
 
    const logCommand = new SlashCommandBuilder()
        .setName('지급완료')
        .setDescription('구매 완료 로그를 전송합니다.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option => option.setName('구매자').setDescription('구매한 유저').setRequired(true))
        .addStringOption(option =>
            option.setName('종류')
                .setDescription('구매 종류')
                .setRequired(true)
                .addChoices(
                    { name: '로벅스 구매', value: 'robux' },
                    { name: '인게임 상품 구매', value: 'ingame' },
                    { name: '기타 구매', value: 'etc' }
                )
        )
        .addStringOption(option => option.setName('상품').setDescription('구매한 상품명 (로벅스는 "로벅스"라고 입력)').setRequired(true))
        .addStringOption(option => option.setName('수량').setDescription('구매한 수량 (로벅스는 로벅스 수량)').setRequired(true))
        .addStringOption(option => option.setName('금액').setDescription('사용된 금액').setRequired(true))
        .addStringOption(option => option.setName('로블아이디').setDescription('구매자의 로블록스 아이디 (없으면 X 입력 → 디스코드 프사만 표시)').setRequired(true))
        .addUserOption(option => option.setName('판매자').setDescription('해당 관리 판매자').setRequired(false));
 
    const panelCommand = new SlashCommandBuilder()
        .setName('패널')
        .setDescription('안내 패널을 생성합니다.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
 
    const infoSetCommand = new SlashCommandBuilder()
        .setName('정보설정')
        .setDescription('유저의 구매 정보를 직접 설정합니다. (입력한 항목만 변경, 아무것도 안 넣으면 현재 값 확인)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option => option.setName('유저').setDescription('설정할 유저').setRequired(true))
        .addIntegerOption(option => option.setName('로벅스').setDescription('구매한 로벅스 총 수량').setMinValue(0).setRequired(false))
        .addIntegerOption(option => option.setName('금액').setDescription('총 구매 금액(원) - 인게임/기타/로벅스 합계').setMinValue(0).setRequired(false))
        .addIntegerOption(option => option.setName('거래횟수').setDescription('총 거래 횟수').setMinValue(0).setRequired(false))
        .addIntegerOption(option => option.setName('초대수').setDescription('초대한 사람 수').setMinValue(0).setRequired(false));
 
    const backupCommand = new SlashCommandBuilder()
        .setName('데이터백업')
        .setDescription('저장된 구매/통계 데이터 파일(data.json)을 받아옵니다.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
 
    await client.application.commands.create(logCommand);
    await client.application.commands.create(infoSetCommand);
    await client.application.commands.create(backupCommand);
    await client.application.commands.create(panelCommand);
    console.log('슬래시 명령어 등록 완료');
 
    // 티켓 / 퇴장 메시지 + 웹 대시보드 시작
    tickets.init(client);
    community.init(client);
    web.start(client);
});
 
client.on('interactionCreate', async interaction => {
 
    // 티켓 (패널 버튼·선택기 / 양식 / 닫기 / 다시 열기 / 삭제) - 대시보드에서 설정한 대로 동작
    if (await tickets.handleInteraction(interaction)) return;
 
    if (interaction.isButton()) {
 
        if (interaction.customId === 'notice_btn') {
            await interaction.reply({
                content:
                    `### <#1457384179535712473> 미작성 시 주의사항\n` +
                    `-# - 2일 내 작성하지 않으면 <@&1550129139086794852> 지급돼요.\n` +
                    `-# - 해당 역할 보유 시 다음 번 구매가 어려울 수 있어요.`,
                ephemeral: true
            });
            return;
        }
 
        if (interaction.customId === 'panel_inquiry') {
            await interaction.reply({ content: '문의사항이 있다면 관리자에게 문의해주세요.', ephemeral: true });
            return;
        }
 
        if (interaction.customId === 'panel_apply') {
            await interaction.reply({ content: '신청을 진행하려면 안내사항을 먼저 확인해주세요.', ephemeral: true });
            return;
        }
 
        if (interaction.customId === 'panel_rules') {
            await interaction.reply({ content: '서버 이용 규정을 확인해주세요.', ephemeral: true });
            return;
        }
 
        if (interaction.customId === 'panel_help') {
            await interaction.reply({ content: '도움이 필요한 경우 관리자에게 문의해주세요.', ephemeral: true });
            return;
        }
 
        return;
    }
 
    if (!interaction.isChatInputCommand()) return;
 
    // /패널
    if (interaction.commandName === '패널') {
 
        const title = new TextDisplayBuilder().setContent('## 서버 이용 안내');
        const description = new TextDisplayBuilder().setContent(
            '필요한 메뉴를 아래에서 선택해주세요.\n' +
            '각 버튼을 눌러 관련 안내를 확인할 수 있습니다.'
        );
 
        const panelButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel_inquiry').setLabel('문의').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('panel_apply').setLabel('신청').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('panel_rules').setLabel('규정').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('panel_help').setLabel('도움말').setStyle(ButtonStyle.Secondary)
        );
 
        const panel = new ContainerBuilder()
            .setAccentColor(LIGHT_PINK_COLOR)
            .addTextDisplayComponents(title)
            .addTextDisplayComponents(description)
            .addActionRowComponents(panelButtons);
 
        await interaction.channel.send({
            components: [panel],
            flags: MessageFlags.IsComponentsV2
        });
 
        await interaction.reply({ content: '패널을 생성했습니다.', ephemeral: true });
 
        return;
    }
 
    // /정보설정
    if (interaction.commandName === '정보설정') {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: '이 명령어를 사용할 권한이 없습니다.', ephemeral: true });
        }
        const target = interaction.options.getUser('유저');
        const patch = {};
        for (const [opt, key] of [['로벅스', 'robux'], ['금액', 'spent'], ['거래횟수', 'count'], ['초대수', 'invites']]) {
            const v = interaction.options.getInteger(opt);
            if (v !== null) patch[key] = v;
        }
        const changed = Object.keys(patch).length > 0;
        const u = changed ? store.setUser(target.id, patch) : store.getUser(target.id);
        return interaction.reply({
            ephemeral: true,
            content:
                `${changed ? '✅ 저장했어요.' : 'ℹ️ 현재 값이에요.'} ${target} 님\n` +
                `• 구매한 로벅스: ${u.robux.toLocaleString()} R$\n` +
                `• 총 구매 금액: ${u.spent.toLocaleString()}원\n` +
                `• 총 거래 횟수: ${u.count.toLocaleString()}회\n` +
                `• 초대한 사람 수: ${u.invites.toLocaleString()}명`,
            allowedMentions: { parse: [] }
        });
    }
 
    // /데이터백업
    if (interaction.commandName === '데이터백업') {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: '이 명령어를 사용할 권한이 없습니다.', ephemeral: true });
        }
        const fs = require('fs');
        if (!fs.existsSync(store.FILE)) {
            return interaction.reply({ content: '아직 저장된 데이터가 없어요.', ephemeral: true });
        }
        return interaction.reply({
            ephemeral: true,
            content:
                `저장 위치: \`${store.FILE}\`\n` +
                (store.persistent ? '' : '⚠️ Railway Volume이 연결되지 않아 재배포하면 데이터가 사라져요. (Volume 연결 필요)'),
            files: [new AttachmentBuilder(store.FILE, { name: 'data.json' })]
        });
    }
 
    // /지급완료
    if (interaction.commandName === '지급완료') {
 
        await interaction.reply({ content: '지급완료를 처리 중입니다.', ephemeral: true });
 
        const buyer = interaction.options.getUser('구매자');
        const kind = interaction.options.getString('종류');
        const item = interaction.options.getString('상품');
        const count = interaction.options.getString('수량');
        const price = interaction.options.getString('금액');
        const robloxInput = interaction.options.getString('로블아이디').trim();
        const seller = interaction.options.getUser('판매자') || interaction.user;
 
        // 1) 로블록스 아이디 확인 (아바타 필수 → 없는 아이디면 아무것도 처리하지 않음)
        const skipRoblox = robloxInput.toLowerCase() === 'x'; // X 입력 시 로블록스 없이 디스코드 프사만
        const roblox = skipRoblox ? { status: 'skip' } : await lookupRobloxUser(robloxInput);
        if (roblox.status === 'notfound') {
            return interaction.editReply({
                content: `❌ 로블록스 아이디 \`${robloxInput}\` 을(를) 찾을 수 없어요. 철자를 확인하고 다시 입력해 주세요. (아무것도 처리되지 않았어요)`
            });
        }
 
        // 2) 역할 부여 (기존 동작 그대로)
        let buyerMember = null;
        try {
            buyerMember = await interaction.guild.members.fetch(buyer.id);
            if (buyerMember && !buyerMember.roles.cache.has(ROLE_ID)) {
                await buyerMember.roles.add(ROLE_ID);
            }
        } catch (error) {
            console.error('역할 부여 중 오류 발생:', error);
        }
 
        const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
        if (!logChannel) {
            return interaction.followUp({ content: '로그 채널을 찾을 수 없습니다.', ephemeral: true });
        }
 
        // 3) 구매 감사 카드 이미지 생성
        const summary = buildSummary(kind, item, count);
        let cardBuffer = null;
        let warn = '';
 
        // 구매 정보 저장 ($정보 / $통계 / $랭킹에 사용)
        let statWarn = '';
        try {
            const rec = store.recordPurchase({ buyerId: buyer.id, kind, qty: count, price, sellerId: seller.id, item, guildId: interaction.guildId });
            if (rec.spent === 0 || (kind === 'robux' && rec.robux === 0)) {
                statWarn = '⚠️ 금액/수량을 숫자로 읽지 못해 통계에 0으로 기록됐어요. /정보설정 으로 직접 고쳐주세요.';
            }
        } catch (e) {
            console.error('구매 기록 저장 실패:', e);
            statWarn = '⚠️ 구매 기록을 저장하지 못했어요. (통계에 반영되지 않았어요)';
        }
 
        try {
            let sellerMember = null;
            try {
                sellerMember = await interaction.guild.members.fetch(seller.id);
            } catch (e) {}
 
            const avatarOpts = { extension: 'png', size: 256 };
            const buyerAvatarUrl = (buyerMember || buyer).displayAvatarURL(avatarOpts);
            const sellerAvatarUrl = (sellerMember || seller).displayAvatarURL(avatarOpts);
            const guildIconUrl = interaction.guild.iconURL({ extension: 'png', size: 128 });
 
            const tryBuf = (url) => (url ? fetchBuffer(url).catch(() => null) : Promise.resolve(null));
            const [buyerAvatarBuf, sellerAvatarBuf, guildIconBuf] = await Promise.all([
                tryBuf(buyerAvatarUrl),
                tryBuf(sellerAvatarUrl),
                tryBuf(guildIconUrl)
            ]);
 
            let robloxAvatarBuf = null;
            if (roblox.status === 'ok') {
                robloxAvatarBuf = await fetchRobloxAvatar(roblox.id);
            }
            if (!robloxAvatarBuf) {
                robloxAvatarBuf = buyerAvatarBuf; // 로블록스 서버 문제 시 디스코드 프사로 대체
                if (!skipRoblox) warn = '⚠️ 로블록스 아바타를 불러오지 못해 디스코드 프사로 대체했어요. (로블록스 서버 응답 문제일 수 있어요)';
            }
 
            cardBuffer = await renderPurchaseCard({
                kind,
                buyerName: buyer.username, // 서버 닉네임이 아닌 디스코드 아이디
                buyerAvatarBuf,
                robloxAvatarBuf,
                hideBadge: skipRoblox,
                item,
                count,
                price,
                sellerName: seller.username, // 서버 닉네임이 아닌 디스코드 아이디
                sellerAvatarBuf,
                guildName: interaction.guild.name,
                guildIconBuf
            });
        } catch (error) {
            console.error('구매 카드 이미지 생성 실패:', error);
        }
 
        // 4) 구매 로그 전송
        if (cardBuffer) {
            // 이미지를 임베드 안에 넣고, 아래에 작은 글씨로 "서버 프로필 + 가게 이름"만 표시
            const shopName = (SHOP_NAME_OVERRIDE || interaction.guild.name).toUpperCase();
            const guildIcon = interaction.guild.iconURL({ extension: 'png', size: 64 });
 
            // 디스코드 아이디에 로블록스 프로필 링크 연결 (X 입력 시 링크 없이 아이디만)
            const titleName = roblox.status === 'ok'
                ? `[${buyer.username}](https://www.roblox.com/users/${roblox.id}/profile)`
                : buyer.username;
 
            const cardEmbed = new EmbedBuilder()
                .setColor(SKY_COLOR)
                .setDescription(`## ${titleName}님 ${summary} 구매 감사합니다 .ᐟ.ᐟ`.slice(0, 4000))
                .setImage('attachment://purchase.png')
                .setFooter(guildIcon ? { text: shopName, iconURL: guildIcon } : { text: shopName })
                .setTimestamp();
 
            await logChannel.send({
                content: `${buyer}`,
                embeds: [cardEmbed],
                files: [new AttachmentBuilder(cardBuffer, { name: 'purchase.png' })]
            });
        } else {
            // 이미지 생성 실패 시 기존 임베드로 대체
            const logEmbed = new EmbedBuilder()
                .setColor(LIGHT_PINK_COLOR)
                .setDescription(
                    `${buyer}, ${item} (${count}) 구매 감사합니다.\n\n` +
                    `사용된 금액 : ${price}\n\n` +
                    `해당 관리 판매자: ${seller}`
                )
                .setImage(IMAGE_URL);
 
            await logChannel.send({ content: `${buyer}`, embeds: [logEmbed] });
            warn = '⚠️ 구매 카드 이미지 생성에 실패해 기존 임베드로 전송했어요. (폰트 파일/패키지 설치를 확인해 주세요)';
        }
 
        if (warn) {
            interaction.followUp({ content: warn, ephemeral: true }).catch(() => {});
        }
        if (statWarn) {
            interaction.followUp({ content: statWarn, ephemeral: true }).catch(() => {});
        }
 
        const replyEmbed = new EmbedBuilder()
            .setColor(LIGHT_PINK_COLOR)
            .setDescription(
                `아이템이 정상적으로 지급되었습니다.\n` +
                `https://discord.com/channels/1456729030459134115/1457384179535712473 작성은 필수입니다.`
            );
 
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('notice_btn').setLabel('주의사항').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setLabel('후기작성').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${interaction.guildId}/1457384179535712473`)
        );
 
        await interaction.channel.send({
            content: `${buyer}`,
            embeds: [replyEmbed],
            components: [row]
        });
 
        await interaction.editReply({ content: '✅ 지급완료 처리가 완료되었습니다.' }).catch(() => {});
 
        return;
    }
 
});
 
// ==================== $정보 / $통계 / $랭킹 ====================
const infoCooldown = new Map();
function infoCooldownOk(userId) {
    const now = Date.now();
    if (now - (infoCooldown.get(userId) || 0) < 4000) return false;
    infoCooldown.set(userId, now);
    return true;
}
 
const shopNameOf = (guild) => SHOP_NAME_OVERRIDE || guild.name;
 
async function avatarBufOf(memberOrUser) {
    if (!memberOrUser) return null;
    try {
        return await fetchBuffer(memberOrUser.displayAvatarURL({ extension: 'png', size: 256 }));
    } catch (e) {
        return null;
    }
}
 
async function usernameOf(id) {
    if (!id) return '';
    try {
        return (await client.users.fetch(id)).username;
    } catch (e) {
        return '알 수 없음';
    }
}
 
async function buildProfileFile(message, args) {
    let target = message.mentions.users.first() || null;
    if (!target && args[1] && /^\d{15,25}$/.test(args[1])) {
        target = await client.users.fetch(args[1]).catch(() => null);
    }
    if (!target) target = message.author;
 
    const member = await message.guild.members.fetch(target.id).catch(() => null);
    const u = store.getUser(target.id);
    const { rank, total } = store.rankOf(target.id);
    const buf = await renderProfileCard({
        name: target.username, // 서버 닉네임이 아닌 디스코드 아이디
        avatarBuf: await avatarBufOf(member || target),
        guildName: shopNameOf(message.guild),
        grade: resolveGrade(member),
        robux: u.robux,
        spent: u.spent,
        count: u.count,
        rank,
        rankTotal: total,
        joinedTs: member ? member.joinedTimestamp : null,
        invites: u.invites
    });
    return new AttachmentBuilder(buf, { name: 'profile.png' });
}
 
async function buildStatsFile(message) {
    const now = Date.now();
    const week = store.periodStats(now - 7 * 24 * 60 * 60 * 1000);
    const all = store.periodStats(store.STATS_START_TS);
    const periods = [];
    for (const [label, stats] of [['최근 7일', week], ['10월 28일 이후', all]]) {
        periods.push({
            label,
            sub: `${ymd(stats.from)} ~ 현재`,
            stats,
            topBuyerName: await usernameOf(stats.topBuyer && stats.topBuyer.id),
            topInviterName: await usernameOf(stats.topInviter && stats.topInviter.id)
        });
    }
    const buf = await renderStatsCard({ guildName: shopNameOf(message.guild), periods });
    return new AttachmentBuilder(buf, { name: 'stats.png' });
}
 
async function buildRankFile(message) {
    const list = store.ranking().slice(0, 10);
    const entries = await Promise.all(list.map(async (u, i) => {
        const member = await message.guild.members.fetch(u.id).catch(() => null);
        const user = member ? member.user : await client.users.fetch(u.id).catch(() => null);
        return {
            rank: i + 1,
            name: user ? user.username : '알 수 없음',
            avatarBuf: await avatarBufOf(member || user),
            grade: resolveGrade(member),
            spent: u.spent,
            robux: u.robux
        };
    }));
    const buf = await renderRankCard({ guildName: shopNameOf(message.guild), entries });
    return new AttachmentBuilder(buf, { name: 'rank.png' });
}
 
// $가격 / $로벅스
client.on('messageCreate', async message => {
 
    if (message.author.bot) return;
 
    // 티켓 채널의 !close / !open / !delete, 그리고 대시보드에서 만든 자동응답
    if (await tickets.handleMessage(message).catch((e) => { console.error('[티켓] 명령어 오류:', e); return false; })) return;
    if (await community.handleMessage(message).catch((e) => { console.error('[자동응답] 오류:', e); return false; })) return;
 
    const args = message.content.trim().split(/\s+/);
    const command = args[0];
 
    switch (command) {
 
        case '$정보':
        case '$통계':
        case '$랭킹': {
            if (!message.guild) return;
            if (!infoCooldownOk(message.author.id)) return;
            message.channel.sendTyping().catch(() => {});
            try {
                const file = command === '$정보'
                    ? await buildProfileFile(message, args)
                    : command === '$통계'
                        ? await buildStatsFile(message)
                        : await buildRankFile(message);
                return message.reply({ files: [file], allowedMentions: { repliedUser: false } });
            } catch (e) {
                console.error(`${command} 이미지 생성 실패:`, e);
                return message.reply('이미지를 만드는 중 오류가 났어요. 잠시 후 다시 시도해 주세요.');
            }
        }
 
        case '$가격':
        case '$로벅스': {
 
            if (!message.member || !message.member.roles.cache.has(CALCULATOR_ROLE_ID)) {
                return message.reply('해당 명령어를 사용할 권한이 없습니다.');
            }
 
            const tempMsg = await message.reply('계산을 진행 중입니다.');
 
            try {
                if (message.deletable) await message.delete();
            } catch (err) {
                console.error('유저 메시지 삭제 오류:', err);
            }
 
            await sleep(2000);
 
            try {
                if (tempMsg.deletable) await tempMsg.delete();
            } catch (err) {
                console.error('안내 메시지 삭제 오류:', err);
            }
 
            if (command === '$가격') {
                const rate = parseFloat(args[1]);
                const robux = parseFloat(args[2]);
 
                if (isNaN(rate) || isNaN(robux) || rate <= 0 || robux <= 0) {
                    return message.channel.send(
                        '사용법: `$가격 (만 원당 로벅스량) (구매할 로벅스 수)`\n' +
                        '예시: `$가격 1300 240`'
                    );
                }
 
                const rawPrice = (robux / rate) * 10000;
                const finalPrice = Math.ceil(rawPrice / 100) * 100;
 
                try {
                    const cardBuf = await renderCalcCard({
                        mode: 'price',
                        rate,
                        amountIn: robux,
                        result: finalPrice,
                        guildName: message.guild ? message.guild.name : '',
                        guildIconBuf: await getGuildIconBuf(message.guild)
                    });
                    return message.channel.send({ files: [new AttachmentBuilder(cardBuf, { name: 'calc.png' })] });
                } catch (e) {
                    console.error('계산기 카드 생성 실패, 임베드로 대체:', e);
                }
 
                const embed = new EmbedBuilder()
                    .setColor(LIGHT_PINK_COLOR)
                    .setDescription(
                        `## 로벅스 가격 결과\n` +
                        `**만 원당 로벅스 가격 : \`${rate.toLocaleString()}\`\n` +
                        `구매할 로벅스 수량 : \`${robux.toLocaleString()}\`**\n\n` +
                        `**계산된 로벅스 가격 = \`${finalPrice.toLocaleString()}\`원**`
                    );
 
                return message.channel.send({ embeds: [embed] });
            }
 
            if (command === '$로벅스') {
                const rate = parseFloat(args[1]);
                const money = parseFloat(args[2]);
 
                if (isNaN(rate) || isNaN(money) || rate <= 0 || money <= 0) {
                    return message.channel.send(
                        '사용법: `$로벅스 (만 원당 로벅스량) (보낼 돈)`\n' +
                        '예시: `$로벅스 1300 1900`'
                    );
                }
 
                const totalRobux = Math.floor((money / 10000) * rate);
 
                try {
                    const cardBuf = await renderCalcCard({
                        mode: 'robux',
                        rate,
                        amountIn: money,
                        result: totalRobux,
                        guildName: message.guild ? message.guild.name : '',
                        guildIconBuf: await getGuildIconBuf(message.guild)
                    });
                    return message.channel.send({ files: [new AttachmentBuilder(cardBuf, { name: 'calc.png' })] });
                } catch (e) {
                    console.error('계산기 카드 생성 실패, 임베드로 대체:', e);
                }
 
                const embed = new EmbedBuilder()
                    .setColor(LIGHT_PINK_COLOR)
                    .setDescription(
                        `## 지급 로벅스 결과\n` +
                        `**만 원당 로벅스 가격 : \`${rate.toLocaleString()}\`\n` +
                        `보낼 금액 : \`${money.toLocaleString()}\`원**\n\n` +
                        `**계산된 로벅스 수량 = \`${totalRobux.toLocaleString()}\` R$**`
                    );
 
                return message.channel.send({ embeds: [embed] });
            }
 
            break;
        }
    }
 
});
 
// 로그인
if (!BOT_TOKEN) {
    const similar = Object.keys(process.env).filter(k => /token/i.test(k));
    console.error("오류: TOKEN이 설정되어 있지 않습니다. .env 파일이나 환경 변수를 확인해주세요.");
    console.error(`감지된 토큰 관련 변수 이름: ${similar.length ? similar.map(k => `"${k}"`).join(', ') : '(없음)'}`);
    console.error('Railway → 이 서비스의 Variables 탭에 TOKEN (또는 DISCORD_TOKEN) 이 있는지, 추가 후 Deploy 했는지 확인하세요.');
} else {
    client.login(BOT_TOKEN);
}
 
