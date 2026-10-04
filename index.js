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
    ChannelType
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// 기본 설정
const LOG_CHANNEL_ID = '1457384858065047663';
const ROLE_ID = '1457383788236505299';
const CALCULATOR_ROLE_ID = '1456747541348749342';
const IMAGE_URL = 'https://i.imgur.com/jokl6LQ.gif';
const LIGHT_PINK_COLOR = 0xFFB6C1;

// 저장소
const eventDataMap = new Map(); // MessageID -> { logChannelId, coopRoleId, betrayRoleId, choices: Map<UserID, {choice, user}>, title }
const activeTimers = new Map();
const closedEvents = new Set();
const giveawayParticipants = new Map(); // GiveawayMessageID -> Set<UserID>
const giveawayAllowedUsers = new Map(); // GiveawayMessageID -> Set<UserID> (이벤트 참여자 목록)

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function parseDuration(str) {
    if (!str) return null;
    const regex = /^(\d+)\s*([smhd])$/i;
    const match = str.trim().match(regex);
    if (!match) return null;

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    switch (unit) {
        case 's': return value * 1000;
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return null;
    }
}

function createProgressBar(percent, length = 10) {
    const filled = Math.round((percent / 100) * length);
    const empty = length - filled;
    return '🟩'.repeat(filled) + '⬜'.repeat(empty);
}

// 기브어웨이 마감 및 추첨 (2명)
async function endGiveaway(channel, giveawayMessageId, eventTitle) {
    try {
        const message = await channel.messages.fetch(giveawayMessageId);
        if (!message) return;

        const participants = giveawayParticipants.get(giveawayMessageId) || new Set();
        const winnerCount = 2;
        const participantArray = Array.from(participants);

        let winnerText = '';

        if (participantArray.length === 0) {
            winnerText = '참여자가 없어 당첨자를 선발하지 못했습니다.';
        } else {
            const shuffled = participantArray.sort(() => 0.5 - Math.random());
            const winners = shuffled.slice(0, Math.min(winnerCount, participantArray.length));
            winnerText = winners.map(id => `<@${id}>`).join(', ');
        }

        const disabledButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('giveaway_enter')
                .setLabel('기브어웨이 마감됨')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );

        const endTitle = new TextDisplayBuilder()
            .setContent(`## [기브어웨이 종료] - ${eventTitle}`);

        const endDesc = new TextDisplayBuilder()
            .setContent(
                `이벤트 기브어웨이가 종료되었습니다.\n\n` +
                `총 응모자 수: \`${participantArray.length}명\`\n` +
                `당첨자 (2명): ${winnerText}`
            );

        const closedContainer = new ContainerBuilder()
            .setAccentColor(0xFFD700)
            .addTextDisplayComponents(endTitle)
            .addSeparatorComponents(new SeparatorBuilder())
            .addTextDisplayComponents(endDesc)
            .addSeparatorComponents(new SeparatorBuilder())
            .addActionRowComponents(disabledButton);

        await message.edit({
            components: [closedContainer],
            flags: MessageFlags.IsComponentsV2
        });

        if (participantArray.length > 0) {
            await channel.send({
                content: `축하합니다! **[ ${eventTitle} ]** 기브어웨이 당첨자: ${winnerText}`
            });
        }

        giveawayParticipants.delete(giveawayMessageId);
        giveawayAllowedUsers.delete(giveawayMessageId);
    } catch (err) {
        console.error('기브어웨이 마감 처리 실패:', err);
    }
}

// 이벤트 패널 종료 처리
async function closeEventPanel(channelId, messageId) {
    if (closedEvents.has(messageId)) {
        return 'already_closed';
    }

    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return 'not_found';

        const message = await channel.messages.fetch(messageId);
        if (!message) return 'not_found';

        const data = eventDataMap.get(messageId) || { choices: new Map(), title: '이벤트' };
        const choicesMap = data.choices;
        const totalUsers = choicesMap.size;

        let coopCount = 0;
        let betrayCount = 0;

        for (const userVal of choicesMap.values()) {
            if (userVal.choice === 'cooperate') coopCount++;
            if (userVal.choice === 'betray') betrayCount++;
        }

        const coopPercent = totalUsers > 0 ? ((coopCount / totalUsers) * 100).toFixed(1) : 0;
        const betrayPercent = totalUsers > 0 ? ((betrayCount / totalUsers) * 100).toFixed(1) : 0;

        const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('game_cooperate')
                .setLabel('협력 (마감)')
                .setStyle(ButtonStyle.Success)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId('game_betray')
                .setLabel('배신 (마감)')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`view_event_logs_${messageId}_0`)
                .setLabel('참여자 목록 보기')
                .setStyle(ButtonStyle.Primary)
        );

        const closedTitle = new TextDisplayBuilder()
            .setContent(`## [이벤트 마감] 통계 결과`);

        const statsDescription = new TextDisplayBuilder()
            .setContent(
                `총 참여 인원: \`${totalUsers}명\`\n\n` +
                `협력: \`${coopCount}명\` (\`${coopPercent}%\`)\n` +
                `${createProgressBar(coopPercent)}\n\n` +
                `배신: \`${betrayCount}명\` (\`${betrayPercent}%\`)\n` +
                `${createProgressBar(betrayPercent)}\n\n` +
                `-# 아래 [참여자 목록 보기] 버튼을 눌러 개별 선택 결과를 확인할 수 있습니다.`
            );

        const closedContainer = new ContainerBuilder()
            .setAccentColor(0x808080)
            .addTextDisplayComponents(closedTitle)
            .addSeparatorComponents(new SeparatorBuilder())
            .addTextDisplayComponents(statsDescription)
            .addSeparatorComponents(new SeparatorBuilder())
            .addActionRowComponents(disabledRow);

        await message.edit({
            components: [closedContainer],
            flags: MessageFlags.IsComponentsV2
        });

        closedEvents.add(messageId);

        if (activeTimers.has(messageId)) {
            clearTimeout(activeTimers.get(messageId));
            activeTimers.delete(messageId);
        }

        // 3시간 뒤 마감되는 기브어웨이 패널 생성
        const giveawayDurationMs = 3 * 60 * 60 * 1000;
        const giveawayEndTime = Math.floor((Date.now() + giveawayDurationMs) / 1000);

        const giveawayTitle = new TextDisplayBuilder()
            .setContent(`## [이벤트 기브어웨이] - ${data.title}`);

        const giveawayDesc = new TextDisplayBuilder()
            .setContent(
                `이벤트가 성공적으로 마감되었습니다.\n` +
                `이벤트에서 역할(협력/배신)을 부여받은 참여자만 아래 버튼을 통해 기브어웨이에 응모할 수 있습니다.\n\n` +
                `당첨 인원: \`2명\`\n` +
                `마감 시간: <t:${giveawayEndTime}:R> (<t:${giveawayEndTime}:f> 까지)`
            );

        const giveawayButtonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('giveaway_enter')
                .setLabel('응모하기')
                .setStyle(ButtonStyle.Success)
        );

        const giveawayContainer = new ContainerBuilder()
            .setAccentColor(LIGHT_PINK_COLOR)
            .addTextDisplayComponents(giveawayTitle)
            .addSeparatorComponents(new SeparatorBuilder())
            .addTextDisplayComponents(giveawayDesc)
            .addSeparatorComponents(new SeparatorBuilder())
            .addActionRowComponents(giveawayButtonRow);

        const giveawayMessage = await channel.send({
            components: [giveawayContainer],
            flags: MessageFlags.IsComponentsV2
        });

        // 기브어웨이 응모 자격 유저 목록 (게임 선택을 완료한 유저들만 저장)
        const allowedUserSet = new Set(choicesMap.keys());
        giveawayAllowedUsers.set(giveawayMessage.id, allowedUserSet);
        giveawayParticipants.set(giveawayMessage.id, new Set());

        setTimeout(() => {
            endGiveaway(channel, giveawayMessage.id, data.title);
        }, giveawayDurationMs);

        return 'success';
    } catch (err) {
        console.error('패널 마감 처리 중 오류 발생:', err);
        return 'error';
    }
}

// 참여자 목록 임베드
function buildLogPageEmbeds(targetMessageId, page = 0) {
    const data = eventDataMap.get(targetMessageId);
    if (!data || data.choices.size === 0) {
        return { embeds: [], components: [], error: '기록된 참여 데이터가 없습니다.' };
    }

    const items = Array.from(data.choices.values());
    const itemsPerPage = 5;
    const totalPages = Math.ceil(items.length / itemsPerPage);

    if (page < 0) page = 0;
    if (page >= totalPages) page = totalPages - 1;

    const start = page * itemsPerPage;
    const pageItems = items.slice(start, start + itemsPerPage);

    const embeds = [];

    const overviewEmbed = new EmbedBuilder()
        .setColor(LIGHT_PINK_COLOR)
        .setTitle(`[참여자 목록 로그] (${page + 1} /${totalPages} 페이지)`)
        .setDescription(`**이벤트 제목**: ${data.title}\n**총 참여자 수**: \`${items.length}명\``)
        .setTimestamp();

    embeds.push(overviewEmbed);

    for (const item of pageItems) {
        const choiceText = item.choice === 'cooperate' ? '협력' : '배신';
        const userEmbed = new EmbedBuilder()
            .setColor(item.choice === 'cooperate' ? 0x57F287 : 0xED4245)
            .setAuthor({ name: `${item.user.tag}`, iconURL: item.user.displayAvatarURL() })
            .setThumbnail(item.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '유저', value: `${item.user}`, inline: true },
                { name: '선택한 항목', value: `**${choiceText}**`, inline: true }
            );
        embeds.push(userEmbed);
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`view_event_logs_${targetMessageId}_${page - 1}`)
            .setLabel('이전')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId(`page_indicator`)
            .setLabel(`${page + 1} / ${totalPages}`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`view_event_logs_${targetMessageId}_${page + 1}`)
            .setLabel('다음')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1)
    );

    return { embeds, components: [row] };
}

client.once('ready', async () => {
    console.log(`[릴리웨이] 봇이 성공적으로 실행되었습니다: ${client.user.tag}`);

    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: [] }
        );
    } catch (error) {
        console.error('기존 명령어 삭제 중 오류 발생:', error);
    }

    const logCommand = new SlashCommandBuilder()
        .setName('지급완료')
        .setDescription('구매 완료 로그를 전송합니다.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option => option.setName('구매자').setDescription('구매한 유저').setRequired(true))
        .addStringOption(option => option.setName('상품').setDescription('구매한 상품명').setRequired(true))
        .addStringOption(option => option.setName('수량').setDescription('구매한 수량').setRequired(true))
        .addStringOption(option => option.setName('금액').setDescription('사용된 금액').setRequired(true))
        .addUserOption(option => option.setName('판매자').setDescription('해당 관리 판매자').setRequired(false));

    const panelCommand = new SlashCommandBuilder()
        .setName('패널')
        .setDescription('안내 패널을 생성합니다.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    const coopBetrayCommand = new SlashCommandBuilder()
        .setName('협력배신패널')
        .setDescription('협력/배신 이벤트 패널을 생성합니다.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(option =>
            option.setName('로그채널')
                .setDescription('선택 로그를 전송할 채널')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        )
        .addRoleOption(option =>
            option.setName('협력역할')
                .setDescription('협력 선택 시 지급할 역할')
                .setRequired(true)
        )
        .addRoleOption(option =>
            option.setName('배신역할')
                .setDescription('배신 선택 시 지급할 역할')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('시간')
                .setDescription('진행 시간 입력 (예: 10m, 1h, 1d)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('제목')
                .setDescription('패널 제목')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('문구')
                .setDescription('패널 본문 메시지')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('이미지_url')
                .setDescription('패널 이미지/GIF 링크 (선택)')
                .setRequired(false)
        );

    const endEventCommand = new SlashCommandBuilder()
        .setName('이벤트종료')
        .setDescription('지정한 메시지 ID의 이벤트를 즉시 종료합니다.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('메시지_아이디')
                .setDescription('종료할 이벤트 패널 메시지 ID')
                .setRequired(true)
        );

    const eventLogCommand = new SlashCommandBuilder()
        .setName('이벤트로그')
        .setDescription('해당 이벤트 참여자 목록을 페이지로 조회합니다.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('메시지_아이디')
                .setDescription('조회할 이벤트 패널 메시지 ID')
                .setRequired(true)
        );

    await client.application.commands.create(logCommand);
    await client.application.commands.create(panelCommand);
    await client.application.commands.create(coopBetrayCommand);
    await client.application.commands.create(endEventCommand);
    await client.application.commands.create(eventLogCommand);
    console.log('슬래시 명령어 등록 완료');
});

client.on('interactionCreate', async interaction => {

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

        // 기브어웨이 응모 버튼 클릭
        if (interaction.customId === 'giveaway_enter') {
            const giveawayMsgId = interaction.message.id;
            const allowedUsers = giveawayAllowedUsers.get(giveawayMsgId);
            const participants = giveawayParticipants.get(giveawayMsgId);

            if (!participants || !allowedUsers) {
                return interaction.reply({ content: '이미 마감되었거나 존재하지 않는 기브어웨이입니다.', ephemeral: true });
            }

            // 이벤트 참여 유저 검증
            if (!allowedUsers.has(interaction.user.id)) {
                return interaction.reply({ content: '이 기브어웨이는 이벤트 참가자(협력/배신 역할 부여 유저)만 응모할 수 있습니다.', ephemeral: true });
            }

            if (participants.has(interaction.user.id)) {
                return interaction.reply({ content: '이미 기브어웨이에 응모하셨습니다.', ephemeral: true });
            }

            participants.add(interaction.user.id);
            return interaction.reply({
                content: '기브어웨이 응모가 완료되었습니다! 3시간 뒤 추첨 결과를 확인하세요.',
                ephemeral: true
            });
        }

        // 로그 페이지 이동 버튼
        if (interaction.customId.startsWith('view_event_logs_')) {
            const parts = interaction.customId.split('_');
            const targetMsgId = parts[3];
            const page = parseInt(parts[4], 10) || 0;

            const result = buildLogPageEmbeds(targetMsgId, page);
            if (result.error) {
                return interaction.reply({ content: `${result.error}`, ephemeral: true });
            }

            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ embeds: result.embeds, components: result.components });
            } else {
                await interaction.reply({ embeds: result.embeds, components: result.components, ephemeral: true });
            }
            return;
        }

        // 협력 / 배신 버튼 클릭 및 역할 자동 지급
        if (interaction.customId === 'game_cooperate' || interaction.customId === 'game_betray') {

            const messageId = interaction.message.id;

            if (closedEvents.has(messageId)) {
                await interaction.reply({ content: '이미 종료된 이벤트입니다.', ephemeral: true });
                return;
            }

            const data = eventDataMap.get(messageId);
            if (!data) {
                return interaction.reply({ content: '이벤트 정보를 찾을 수 없습니다.', ephemeral: true });
            }

            const choicesMap = data.choices;
            const userId = interaction.user.id;

            if (choicesMap.has(userId)) {
                const existingChoice = choicesMap.get(userId).choice === 'cooperate' ? '협력' : '배신';
                await interaction.reply({
                    content: `이미 선택을 완료하셨습니다. (선택 항목: **${existingChoice}**)`,
                    ephemeral: true
                });
                return;
            }

            const choiceType = interaction.customId === 'game_cooperate' ? 'cooperate' : 'betray';
            const choiceLabel = choiceType === 'cooperate' ? '협력' : '배신';
            const targetRoleId = choiceType === 'cooperate' ? data.coopRoleId : data.betrayRoleId;

            // 역할 지급
            try {
                const member = await interaction.guild.members.fetch(userId);
                if (targetRoleId && member) {
                    await member.roles.add(targetRoleId);
                }
            } catch (err) {
                console.error('역할 부여 실패:', err);
            }

            choicesMap.set(userId, {
                choice: choiceType,
                user: interaction.user
            });

            await interaction.reply({
                content: `**${choiceLabel}** 항목을 선택하였으며, 관련 역할이 지급되었습니다.`,
                ephemeral: true
            });

            // 지정 로그 채널 전송
            try {
                const targetLogChannel = await interaction.guild.channels.fetch(data.logChannelId);
                if (targetLogChannel) {
                    const choiceLogEmbed = new EmbedBuilder()
                        .setColor(choiceType === 'cooperate' ? 0x57F287 : 0xED4245)
                        .setTitle('[이벤트] 플레이어 선택 로그')
                        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: '유저', value: `${interaction.user} (\`${interaction.user.tag}\`)`, inline: true },
                            { name: '선택 항목', value: `**${choiceLabel}**`, inline: true },
                            { name: '지급 역할', value: `<@&${targetRoleId}>`, inline: true }
                        )
                        .setTimestamp();

                    await targetLogChannel.send({ embeds: [choiceLogEmbed] });
                }
            } catch (err) {
                console.error('로그 채널 전송 실패:', err);
            }

            return;
        }

        return;
    }

    if (!interaction.isChatInputCommand()) return;

    // /협력배신패널
    if (interaction.commandName === '협력배신패널') {

        const logChannel = interaction.options.getChannel('로그채널');
        const coopRole = interaction.options.getRole('협력역할');
        const betrayRole = interaction.options.getRole('배신역할');
        const timeInput = interaction.options.getString('시간');
        const customTitle = interaction.options.getString('제목');
        const customDescription = interaction.options.getString('문구');
        const imageUrl = interaction.options.getString('이미지_url');

        const durationMs = parseDuration(timeInput);
        if (!durationMs) {
            return interaction.reply({
                content: '올바른 시간 형식이 아닙니다. 예시: `10m`, `1h`, `1d`',
                ephemeral: true
            });
        }

        const endTime = Math.floor((Date.now() + durationMs) / 1000);

        const titleDisplay = new TextDisplayBuilder()
            .setContent(`## ${customTitle}`);

        const descriptionDisplay = new TextDisplayBuilder()
            .setContent(`${customDescription}\n\n마감 시간: <t:${endTime}:R> (<t:${endTime}:f> 까지)`);

        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('game_cooperate')
                .setLabel('협력')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('game_betray')
                .setLabel('배신')
                .setStyle(ButtonStyle.Danger)
        );

        const panelContainer = new ContainerBuilder()
            .setAccentColor(LIGHT_PINK_COLOR)
            .addTextDisplayComponents(titleDisplay)
            .addSeparatorComponents(new SeparatorBuilder())
            .addTextDisplayComponents(descriptionDisplay);

        if (imageUrl) {
            try {
                const mediaItem = new MediaGalleryItemBuilder().setURL(imageUrl);
                const mediaGallery = new MediaGalleryBuilder().addItems(mediaItem);
                panelContainer.addMediaGalleryComponents(mediaGallery);
            } catch (e) {
                console.error('이미지 설정 실패:', e);
            }
        }

        panelContainer
            .addSeparatorComponents(new SeparatorBuilder())
            .addActionRowComponents(actionRow);

        const panelMessage = await interaction.channel.send({
            components: [panelContainer],
            flags: MessageFlags.IsComponentsV2
        });

        eventDataMap.set(panelMessage.id, {
            logChannelId: logChannel.id,
            coopRoleId: coopRole.id,
            betrayRoleId: betrayRole.id,
            title: customTitle,
            choices: new Map()
        });

        await interaction.reply({
            content: `패널이 생성되었습니다. (메시지 ID: \`${panelMessage.id}\`)`,
            ephemeral: true
        });

        const timer = setTimeout(() => {
            closeEventPanel(interaction.channel.id, panelMessage.id);
        }, durationMs);

        activeTimers.set(panelMessage.id, timer);

        return;
    }

    // /이벤트종료
    if (interaction.commandName === '이벤트종료') {

        const targetMessageId = interaction.options.getString('메시지_아이디');
        const result = await closeEventPanel(interaction.channel.id, targetMessageId);

        if (result === 'already_closed') {
            await interaction.reply({ content: '해당 이벤트는 이미 종료되었거나 마감된 상태입니다.', ephemeral: true });
        } else if (result === 'success') {
            await interaction.reply({
                content: `메시지 ID (\`${targetMessageId}\`) 이벤트가 종료되었습니다.\n3시간 후 추첨되는 기브어웨이 패널이 생성되었습니다.`,
                ephemeral: true
            });
        } else {
            await interaction.reply({ content: '해당 메시지를 찾을 수 없습니다.', ephemeral: true });
        }

        return;
    }

    // /이벤트로그
    if (interaction.commandName === '이벤트로그') {

        const targetMessageId = interaction.options.getString('메시지_아이디');
        const result = buildLogPageEmbeds(targetMessageId, 0);

        if (result.error) {
            return interaction.reply({ content: `${result.error}`, ephemeral: true });
        }

        await interaction.reply({
            content: `이벤트 참여자 목록 조회 결과입니다.`,
            embeds: result.embeds,
            components: result.components,
            ephemeral: true
        });

        return;
    }

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

    // /지급완료
    if (interaction.commandName === '지급완료') {

        await interaction.reply({ content: '지급완료를 처리 중입니다.', ephemeral: true });

        const buyer = interaction.options.getUser('구매자');
        const item = interaction.options.getString('상품');
        const count = interaction.options.getString('수량');
        const price = interaction.options.getString('금액');
        const seller = interaction.options.getUser('판매자') || interaction.user;

        try {
            const member = await interaction.guild.members.fetch(buyer.id);
            if (member && !member.roles.cache.has(ROLE_ID)) {
                await member.roles.add(ROLE_ID);
            }
        } catch (error) {
            console.error('역할 부여 중 오류 발생:', error);
        }

        const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
        if (!logChannel) {
            return interaction.followUp({ content: '로그 채널을 찾을 수 없습니다.', ephemeral: true });
        }

        const logEmbed = new EmbedBuilder()
            .setColor(LIGHT_PINK_COLOR)
            .setDescription(
                `${buyer}, ${item} (${count}) 구매 감사합니다.\n\n` +
                `사용된 금액 : ${price}\n\n` +
                `해당 관리 판매자: ${seller}`
            )
            .setImage(IMAGE_URL);

        await logChannel.send({ content: `${buyer}`, embeds: [logEmbed] });

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

        return;
    }

});

// $가격 / $로벅스
client.on('messageCreate', async message => {

    if (message.author.bot) return;

    const args = message.content.trim().split(/\s+/);
    const command = args[0];

    switch (command) {

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

if (!process.env.TOKEN) {
    console.error("오류: TOKEN이 설정되어 있지 않습니다.");
    process.exit(1);
}

client.login(process.env.TOKEN);
