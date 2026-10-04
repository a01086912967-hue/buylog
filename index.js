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

// 부계정 방지 설정 (계정 생성 후 최소 일수)
const MIN_ACCOUNT_AGE_DAYS = 7;

// 저장소
const eventDataMap = new Map(); // MessageID -> { logChannelId, coopRoleId, betrayRoleId, title, giveawayDurationMs, giveawayChannelId, giveawayWinnerCount, pingRoleId, choices: Map }
const activeTimers = new Map();
const closedEvents = new Set();
const giveawayParticipants = new Map(); // GiveawayMessageID -> Set<UserID>
const giveawayAllowedUsers = new Map(); // GiveawayMessageID -> Set<UserID>
const giveawayMaxParticipants = new Map(); // GiveawayMessageID -> maxAllowedCount
const giveawayParentEventMap = new Map(); // GiveawayMessageID -> EventMessageID

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

// 기브어웨이 마감 및 추첨
async function endGiveaway(channel, giveawayMessageId, eventTitle, winnerCount = 1) {
    try {
        const message = await channel.messages.fetch(giveawayMessageId);
        if (!message) return;

        const participants = giveawayParticipants.get(giveawayMessageId) || new Set();
        const participantArray = Array.from(participants);

        const parentEventId = giveawayParentEventMap.get(giveawayMessageId);
        const parentEvent = parentEventId ? eventDataMap.get(parentEventId) : null;

        let winnerTextWithChoice = '';

        if (participantArray.length === 0) {
            winnerTextWithChoice = '참여자가 없어 당첨자를 선발하지 못했습니다.';
        } else {
            const shuffled = participantArray.sort(() => 0.5 - Math.random());
            const winners = shuffled.slice(0, Math.min(winnerCount, participantArray.length));

            winnerTextWithChoice = winners.map(id => {
                let choiceStr = '미확인';
                if (parentEvent && parentEvent.choices.has(id)) {
                    const userChoice = parentEvent.choices.get(id).choice;
                    choiceStr = userChoice === 'cooperate' ? '협력' : '배신';
                }
                return `<@${id}> (${choiceStr})`;
            }).join(', ');
        }

        const disabledButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('giveaway_enter')
                .setLabel(`기브어웨이 마감됨 (총 ${participantArray.length}명)`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );

        const endTitle = new TextDisplayBuilder()
            .setContent(`## [기브어웨이 종료] - ${eventTitle}`);

        const endDesc = new TextDisplayBuilder()
            .setContent(
                `이벤트 기브어웨이가 종료되었습니다.\n\n` +
                `총 응모자 수: \`${participantArray.length}명\`\n` +
                `당첨자 (${winnerCount}명): ${winnerTextWithChoice}`
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
            await message.reply({
                content: `🎉 축하합니다! **${eventTitle}** 기브어웨이 당첨자: ${winnerTextWithChoice}`,
                allowedMentions: { parse: ['users'] }
            });
        }

        giveawayParticipants.delete(giveawayMessageId);
        giveawayAllowedUsers.delete(giveawayMessageId);
        giveawayMaxParticipants.delete(giveawayMessageId);
        giveawayParentEventMap.delete(giveawayMessageId);
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

        const data = eventDataMap.get(messageId) || { choices: new Map(), title: '이벤트', giveawayDurationMs: 3 * 60 * 60 * 1000, giveawayWinnerCount: 1 };
        const choicesMap = data.choices;
        const totalUsers = choicesMap.size;

        const coopUsers = [];
        const betrayUsers = [];

        for (const [uId, userVal] of choicesMap.entries()) {
            if (userVal.choice === 'cooperate') coopUsers.push({ id: uId, timestamp: userVal.timestamp });
            if (userVal.choice === 'betray') betrayUsers.push({ id: uId, timestamp: userVal.timestamp });
        }

        const coopCount = coopUsers.length;
        const betrayCount = betrayUsers.length;

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

        // --- 딜레마 규칙에 따른 기브어웨이 응모 자격 산출 ---
        let allowedUserSet = new Set();
        let maxAllowedCount = null;
        let ruleNoticeText = '';

        if (totalUsers === 0) {
            ruleNoticeText = '이벤트 참여자가 없어 기브어웨이가 진행되지 않습니다.';
        } else if (betrayCount === 0) {
            // 모두 협력: 먼저 선택(클릭)한 선착순 절반만 자격 부여
            coopUsers.sort((a, b) => a.timestamp - b.timestamp);
            const limit = Math.max(1, Math.floor(totalUsers / 2));
            
            allowedUserSet = new Set(coopUsers.map(u => u.id));
            maxAllowedCount = limit;
            ruleNoticeText = `**[모두 협력 결과]** 선착순 **${limit}명**만 응모할 수 있습니다. (응모 기준: 먼저 응모 버튼을 누르는 사람)`;
        } else if (coopCount > 0 && betrayCount > 0) {
            allowedUserSet = new Set(betrayUsers.map(u => u.id));
            ruleNoticeText = `**[협력 + 배신 결과]** **배신**을 선택한 유저만 응모할 수 있습니다.`;
        } else if (coopCount === 0 && betrayCount > 0) {
            ruleNoticeText = `**[모두 배신 결과]** 모든 유저가 배신을 선택하여 **아무도 기브어웨이에 응모할 수 없습니다.**`;
        }

        if (allowedUserSet.size > 0) {
            let targetGiveawayChannel = channel;
            if (data.giveawayChannelId) {
                try {
                    const fetchedChan = await client.channels.fetch(data.giveawayChannelId);
                    if (fetchedChan) targetGiveawayChannel = fetchedChan;
                } catch (e) {
                    console.error('기브어웨이 채널 조회 실패, 기본 채널로 진행:', e);
                }
            }

            const giveawayDurationMs = data.giveawayDurationMs || (3 * 60 * 60 * 1000);
            const giveawayEndTime = Math.floor((Date.now() + giveawayDurationMs) / 1000);

            const giveawayTitle = new TextDisplayBuilder()
                .setContent(`## [이벤트 기브어웨이] - ${data.title}`);

            const maxText = maxAllowedCount ? ` (선착순 제한: 최대 ${maxAllowedCount}명)` : '';

            const giveawayDesc = new TextDisplayBuilder()
                .setContent(
                    `이벤트가 성공적으로 마감되었습니다.\n` +
                    `${ruleNoticeText}\n\n` +
                    `마감 시간: <t:${giveawayEndTime}:R> (<t:${giveawayEndTime}:f> 까지)`
                );

            const giveawayButtonRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('giveaway_enter')
                    .setLabel(`응모하기 (현재 0명${maxText})`)
                    .setStyle(ButtonStyle.Success)
            );

            const giveawayContainer = new ContainerBuilder()
                .setAccentColor(LIGHT_PINK_COLOR)
                .addTextDisplayComponents(giveawayTitle)
                .addSeparatorComponents(new SeparatorBuilder())
                .addTextDisplayComponents(giveawayDesc)
                .addSeparatorComponents(new SeparatorBuilder())
                .addActionRowComponents(giveawayButtonRow);

            const sendOptions = {
                components: [giveawayContainer],
                flags: MessageFlags.IsComponentsV2
            };

            // 멘션 핑 정상 작동 처리
            if (data.pingRoleId) {
                sendOptions.content = `<@&${data.pingRoleId}>`;
                sendOptions.allowedMentions = { roles: [data.pingRoleId] };
            }

            const giveawayMessage = await targetGiveawayChannel.send(sendOptions);

            giveawayAllowedUsers.set(giveawayMessage.id, allowedUserSet);
            giveawayMaxParticipants.set(giveawayMessage.id, maxAllowedCount);
            giveawayParticipants.set(giveawayMessage.id, new Set());
            giveawayParentEventMap.set(giveawayMessage.id, messageId);

            setTimeout(() => {
                endGiveaway(targetGiveawayChannel, giveawayMessage.id, data.title, data.giveawayWinnerCount);
            }, giveawayDurationMs);
        } else {
            await channel.send({
                content: `📢 **[ ${data.title} ]** 이벤트 결과: ${ruleNoticeText}`
            });
        }

        return 'success';
    } catch (err) {
        console.error('패널 마감 처리 중 오류 발생:', err);
        return 'error';
    }
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
                .setDescription('이벤트 진행 시간 (예: 10m, 1h, 1d)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('기브어웨이시간')
                .setDescription('마감 후 기브어웨이 진행 시간 (예: 10m, 3h, 1d)')
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
        .addRoleOption(option =>
            option.setName('멘션')
                .setDescription('패널 및 기브어웨이 호출 시 핑(멘션)할 역할 (선택)')
                .setRequired(false)
        )
        .addChannelOption(option =>
            option.setName('기브어웨이채널')
                .setDescription('기브어웨이 패널이 생성될 채널 (미설정 시 현재 채널)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('기브어웨이당첨자수')
                .setDescription('기브어웨이 당첨 인원 수 (기본값: 1명)')
                .setMinValue(1)
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('이미지_url')
                .setDescription('패널 이미지/GIF 링크 (선택)')
                .setRequired(false)
        );

    await client.application.commands.create(coopBetrayCommand);
    console.log('슬래시 명령어 등록 완료');
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === '협력배신패널') {
            const logChannel = interaction.options.getChannel('로그채널');
            const coopRole = interaction.options.getRole('협력역할');
            const betrayRole = interaction.options.getRole('배신역할');
            const durationStr = interaction.options.getString('시간');
            const giveawayDurationStr = interaction.options.getString('기브어웨이시간');
            const titleStr = interaction.options.getString('제목');
            const contentStr = interaction.options.getString('문구');
            
            // 멘션 역할 ID 추출
            const pingRole = interaction.options.getRole('멘션');
            const pingRoleId = pingRole ? pingRole.id : null;

            const giveawayChannel = interaction.options.getChannel('기브어웨이채널');
            const giveawayWinnerCount = interaction.options.getInteger('기브어웨이당첨자수') || 1;
            const imageUrl = interaction.options.getString('이미지_url');

            const durationMs = parseDuration(durationStr);
            const giveawayDurationMs = parseDuration(giveawayDurationStr);

            if (!durationMs || !giveawayDurationMs) {
                return interaction.reply({
                    content: '시간 형식이 올바르지 않습니다. (예: 10m, 1h, 2d)',
                    ephemeral: true
                });
            }

            const endTime = Math.floor((Date.now() + durationMs) / 1000);

            const titleComp = new TextDisplayBuilder().setContent(`## [이벤트] ${titleStr}`);
            const descComp = new TextDisplayBuilder().setContent(
                `${contentStr}\n\n` +
                `⏳ **종료 시간**: <t:${endTime}:R> (<t:${endTime}:f> 까지)`
            );

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('game_cooperate')
                    .setLabel('협력')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('game_betray')
                    .setLabel('배신')
                    .setStyle(ButtonStyle.Danger)
            );

            const container = new ContainerBuilder()
                .setAccentColor(LIGHT_PINK_COLOR)
                .addTextDisplayComponents(titleComp)
                .addSeparatorComponents(new SeparatorBuilder())
                .addTextDisplayComponents(descComp)
                .addSeparatorComponents(new SeparatorBuilder())
                .addActionRowComponents(buttons);

            const sendMessageOptions = {
                components: [container],
                flags: MessageFlags.IsComponentsV2
            };

            // 패널 전송 시 멘션 적용
            if (pingRoleId) {
                sendMessageOptions.content = `<@&${pingRoleId}>`;
                sendMessageOptions.allowedMentions = { roles: [pingRoleId] };
            }

            await interaction.reply({ content: '이벤트 패널을 생성 중입니다...', ephemeral: true });

            const eventMsg = await interaction.channel.send(sendMessageOptions);

            // 이벤트 데이터 저장
            eventDataMap.set(eventMsg.id, {
                logChannelId: logChannel.id,
                coopRoleId: coopRole.id,
                betrayRoleId: betrayRole.id,
                title: titleStr,
                giveawayDurationMs: giveawayDurationMs,
                giveawayChannelId: giveawayChannel ? giveawayChannel.id : null,
                giveawayWinnerCount: giveawayWinnerCount,
                pingRoleId: pingRoleId,
                choices: new Map()
            });

            // 마감 타이머 설정
            const timerId = setTimeout(() => {
                closeEventPanel(interaction.channel.id, eventMsg.id);
            }, durationMs);

            activeTimers.set(eventMsg.id, timerId);
            return interaction.editReply({ content: '성공적으로 이벤트 패널이 생성되었습니다!' });
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'giveaway_enter') {
            const giveawayMsgId = interaction.message.id;
            const allowedUsers = giveawayAllowedUsers.get(giveawayMsgId);
            const participants = giveawayParticipants.get(giveawayMsgId);
            const maxParticipants = giveawayMaxParticipants.get(giveawayMsgId);

            if (!participants || !allowedUsers) {
                return interaction.reply({ content: '이미 마감되었거나 존재하지 않는 기브어웨이입니다.', ephemeral: true });
            }

            const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
            if (!isAdmin) {
                const accountAgeDays = (Date.now() - interaction.user.createdTimestamp) / (1000 * 60 * 60 * 24);
                if (accountAgeDays < MIN_ACCOUNT_AGE_DAYS) {
                    return interaction.reply({
                        content: `⚠️ 계정 생성 후 최소 ${MIN_ACCOUNT_AGE_DAYS}일이 지나지 않은 계정은 응모할 수 없습니다.`,
                        ephemeral: true
                    });
                }
            }

            if (!allowedUsers.has(interaction.user.id)) {
                return interaction.reply({
                    content: '❌ 이번 기브어웨이에 응모할 수 있는 대상이 아닙니다. (이벤트 선택 결과 조건 불인정)',
                    ephemeral: true
                });
            }

            if (participants.has(interaction.user.id)) {
                return interaction.reply({ content: '이미 이 기브어웨이에 응모하셨습니다.', ephemeral: true });
            }

            if (maxParticipants !== null && participants.size >= maxParticipants) {
                return interaction.reply({
                    content: `❌ 선착순 응모 인원(\`${maxParticipants}명\`)이 이미 모두 차서 더 이상 응모할 수 없습니다!`,
                    ephemeral: true
                });
            }

            participants.add(interaction.user.id);

            const parentEventId = giveawayParentEventMap.get(giveawayMsgId);
            const parentEvent = parentEventId ? eventDataMap.get(parentEventId) : null;
            const eventTitle = parentEvent ? parentEvent.title : '기브어웨이';

            const maxText = maxParticipants ? ` / 제한 ${maxParticipants}명` : '';

            const updatedButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('giveaway_enter')
                    .setLabel(`응모하기 (현재 ${participants.size}명${maxText})`)
                    .setStyle(ButtonStyle.Success)
            );

            try {
                const container = interaction.message.components[0];
                await interaction.message.edit({
                    components: [
                        new ContainerBuilder(container.data)
                            .addActionRowComponents(updatedButton)
                    ],
                    flags: MessageFlags.IsComponentsV2
                });
            } catch (e) {
                console.error('기브어웨이 버튼 카운트 업데이트 실패:', e);
            }

            return interaction.reply({
                content: `🎉 **${eventTitle}** 기브어웨이에 성공적으로 응모되었습니다! (현재 선착순 ${participants.size}번째 응모자)`,
                ephemeral: true
            });
        }
    }
});
