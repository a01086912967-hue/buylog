const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

const TOKEN = process.env.TOKEN;
const PURCHASE_LOG_CHANNEL_ID = process.env.PURCHASE_LOG_CHANNEL_ID;

// 봇이 켜질 때 슬래시 명령어(/지급완료)를 디스코드에 자동으로 등록합니다.
client.once('ready', async () => {
    console.log('봇 준비 완료! (로그 전송 모드)');

    const commands = [
        new SlashCommandBuilder()
            .setName('지급완료')
            .setDescription('지급 완료 알림 및 로그를 전송합니다.')
            .addStringOption(option => 
                option.setName('금액')
                    .setDescription('구매 금액')
                    .setRequired(true))
            .addUserOption(option => 
                option.setName('판매자')
                    .setDescription('담당 판매자')
                    .setRequired(false))
            .addStringOption(option => 
                option.setName('상품')
                    .setDescription('구매한 상품명 (선택사항, 입력 안 하면 자동 감지)')
                    .setRequired(false))
            .addStringOption(option => 
                option.setName('수량')
                    .setDescription('구매 수량 (선택사항, 입력 안 하면 자동 감지)')
                    .setRequired(false))
    ];

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    try {
        console.log('슬래시 명령어 등록 중...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('슬래시 명령어 등록 완료!');
    } catch (error) {
        console.error('슬래시 명령어 등록 실패:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand() && interaction.commandName === '지급완료') {
        await interaction.reply({ content: '처리를 시작합니다.', ephemeral: true });

        // 1. 명령어 옵션값 가져오기
        const optionItemName = interaction.options.getString('상품');
        const optionItemQty = interaction.options.getString('수량');
        const amount = interaction.options.getString('금액');
        const seller = interaction.options.getUser('판매자') || interaction.user;

        let itemName = optionItemName;
        let itemQty = optionItemQty;

        // 2. 명령어 옵션에 입력하지 않은 경우 기존처럼 채널 대화 내역에서 자동 파싱
        if (!itemName || !itemQty) {
            const messages = await interaction.channel.messages.fetch({ limit: 100 });
            const msgs = Array.from(messages.values()).reverse();
            let fullContext = msgs.map(m => m.content + "\n" + m.embeds.map(e => (e.title || "") + "\n" + (e.description || "") + "\n" + e.fields.map(f => f.name + "\n" + f.value).join("\n")).join("\n")).join("\n");

            const lines = fullContext.split('\n');
            
            if (!itemName) {
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes("상품")) {
                        itemName = lines[i + 1]?.replace(/[`'‘’()]/g, '').trim() || "알 수 없음";
                        break;
                    }
                }
            }
            if (!itemQty) {
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes("수량")) {
                        itemQty = lines[i + 1]?.replace(/[`'‘’()]/g, '').trim() || "1";
                        break;
                    }
                }
            }
        }

        // 예외 처리 기본값
        itemName = itemName || "알 수 없음";
        itemQty = itemQty || "1";

        const messages = await interaction.channel.messages.fetch({ limit: 100 });
        const buyer = messages.find(m => m.author.bot && m.mentions.users.size > 0)?.mentions.users.first() || interaction.user;

        // 3. 로그 채널 전송
        try {
            const logChannel = await client.channels.fetch(PURCHASE_LOG_CHANNEL_ID);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor(0xFFD1DC)
                    .setDescription(`°.✩┈┈∘*┈˃̶ ୨<:star_IDS:1523988845735972874>୧˂̶┈*∘┈┈✩.°\n\n${buyer} 님, **${itemName} x ${itemQty}** 구매 감사합니다 .ᐟ.ᐟ\n\n-# 사용된 금액 : ${amount}\n\n-# 해당 관리 판매자: ${seller}\n\n°.✩┈┈∘*┈˃̶ ୨<:star_IDS:1523988845735972874>୧˂̶┈*∘┈┈✩.°\n࣪𓏲ּ ᥫ᭡ ₊ 𝑻𝒉𝒂𝒏𝒌 𝒚𝒐𝒖 ⊹ ˑ ִֶ 𓂃`)
                    .setImage('https://i.imgur.com/jokl6LQ.gif');
                await logChannel.send({ embeds: [logEmbed] });
            } else {
                console.error("로그 채널을 찾을 수 없습니다.");
            }
        } catch (error) {
            console.error("로그 채널 전송 오류:", error);
        }

        // 4. 구매자 DM 발송
        const dmEmbed = new EmbedBuilder()
            .setColor(0xFFD1DC)
            .setTitle("<a:check:1518257176811012217> 구매 완료")
            .setDescription(`°.✩┈┈∘*┈˃̶ ୨<:star_IDS:1523988845735972874>୧˂̶┈*∘┈┈✩.°\n\n구매하신 **(${itemName} × ${itemQty})** 지급이 완료되었습니다!\n이용해 주셔서 감사합니다. <a:Twinkle_heart:1477354232045768804>\n### <:emoji_109:1523981022826336406> 필수 안내\n> • **구매 후기 작성은 필수**입니다.\n> • **구매 금액 기록**도 반드시 남겨 주세요.\n> • 미작성 시 서비스 이용에 제한이 있을 수 있습니다.\n\n감사합니다! 좋은 하루 보내세요. ✨`)
            .setImage('https://i.imgur.com/jokl6LQ.gif');
        
        try { await buyer.send({ embeds: [dmEmbed] }); } catch (e) { }

        // 5. 현재 채널에 완료 안내 메시지 전송
        await interaction.channel.send({
            embeds: [new EmbedBuilder().setColor(0xFFD1DC).setDescription(`${buyer}님, **${itemName} x ${itemQty}** 지급이 완료되었습니다.`)]
        });
    }
});

client.login(TOKEN);
