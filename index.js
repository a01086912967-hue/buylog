const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

// 환경 변수 사용 (Railway 배포용)
const TOKEN = process.env.TOKEN;
const REVIEW_CHANNEL_ID = process.env.REVIEW_CHANNEL_ID;
const PURCHASE_LOG_CHANNEL_ID = process.env.PURCHASE_LOG_CHANNEL_ID;

client.once('ready', async () => {
    console.log('봇 준비 완료!');
});

client.on('interactionCreate', async interaction => {
    // 1. 후기 버튼(모달) 처리
    if (interaction.isButton() && interaction.customId === 'write_review') {
        const modal = new ModalBuilder().setCustomId('review_modal').setTitle('구매 후기 작성');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('review_text').setLabel('후기를 작성해주세요').setStyle(TextInputStyle.Paragraph)));
        return await interaction.showModal(modal);
    }

    // 2. 모달 제출 처리
    if (interaction.isModalSubmit() && interaction.customId === 'review_modal') {
        const review = interaction.fields.getTextInputValue('review_text');
        const guild = interaction.guild;
        const channel = guild.channels.cache.get(REVIEW_CHANNEL_ID);
        
        if (channel) {
            await channel.send({ 
                embeds: [new EmbedBuilder()
                    .setColor(0xFFD1DC)
                    .setTitle("✨ 새로운 구매 후기")
                    .setDescription(review)
                    .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
                    .addFields({ name: '작성자', value: `${interaction.user}` })
                    .setFooter({ text: `작성자: ${interaction.user.tag}` })
                    .setTimestamp()] 
            });
            return await interaction.reply({ content: '후기가 성공적으로 등록되었습니다!', ephemeral: true });
        } else {
            return await interaction.reply({ content: '오류: 후기 채널을 찾을 수 없습니다.', ephemeral: true });
        }
    }

    // 3. 지급완료 명령어
    if (interaction.isChatInputCommand() && interaction.commandName === '지급완료') {
        await interaction.reply({ content: '처리를 시작합니다.', ephemeral: true });

        const messages = await interaction.channel.messages.fetch({ limit: 100 });
        const msgs = Array.from(messages.values()).reverse();
        let fullContext = msgs.map(m => m.content + "\n" + m.embeds.map(e => (e.title || "") + "\n" + (e.description || "") + "\n" + e.fields.map(f => f.name + "\n" + f.value).join("\n")).join("\n")).join("\n");

        const lines = fullContext.split('\n');
        let itemName = "알 수 없음";
        let itemQty = "1";

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes("구매할 아이템 이름")) itemName = lines[i + 1]?.replace(/[`'‘’()]/g, '').trim() || "알 수 없음";
            if (lines[i].includes("수량을 입력")) itemQty = lines[i + 1]?.replace(/[`'‘’()]/g, '').trim() || "1";
        }

        const buyer = messages.find(m => m.author.bot && m.mentions.users.size > 0)?.mentions.users.first() || interaction.user;
        const amount = interaction.options.getString('금액');
        const seller = interaction.options.getUser('판매자') || interaction.user;

        // 로그 채널 전송
        const logChannel = interaction.guild.channels.cache.get(PURCHASE_LOG_CHANNEL_ID);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setColor(0xFFD1DC)
                .setDescription(`°.✩┈┈∘*┈˃̶ ୨<:star_IDS:1523988845735972874>୧˂̶┈*∘┈┈✩.°\n\n${buyer} 님, **${itemName} x ${itemQty}** 구매 감사합니다 .ᐟ.ᐟ\n\n-# 사용된 금액 : ${amount}\n\n-# 해당 관리 판매자: ${seller}\n\n°.✩┈┈∘*┈˃̶ ୨<:star_IDS:1523988845735972874>୧˂̶┈*∘┈┈✩.°\n࣪𓏲ּ ᥫ᭡ ₊ 𝑻𝒉𝒂𝒏𝒌 𝒚𝒐𝒖 ⊹ ˑ ִֶ 𓂃`)
                .setImage('https://i.imgur.com/jokl6LQ.gif');
            logChannel.send({ embeds: [logEmbed] });
        }
        // DM 발송 (버튼 제거됨)
        const dmEmbed = new EmbedBuilder()
            .setColor(0xFFD1DC)
            .setTitle("<a:check:1518257176811012217> 구매 완료")
            .setDescription(`°.✩┈┈∘*┈˃̶ ୨<:star_IDS:1523988845735972874>୧˂̶┈*∘┈┈✩.°\n\n구매하신 **(${itemName} × ${itemQty})** 지급이 완료되었습니다!\n이용해 주셔서 감사합니다. <a:Twinkle_heart:1477354232045768804>\n### <:emoji_109:1523981022826336406> 필수 안내\n> • **구매 후기 작성은 필수**입니다.\n> • **구매 금액 기록**도 반드시 남겨 주세요.\n> • 미작성 시 서비스 이용에 제한이 있을 수 있습니다.\n\n감사합니다! 좋은 하루 보내세요. ✨`)
            .setImage('https://i.imgur.com/jokl6LQ.gif');
        
        try { await buyer.send({ embeds: [dmEmbed] }); } catch (e) { }

        // 채널 메시지 (버튼 포함)
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('write_review').setLabel('구매 후기 작성').setStyle(ButtonStyle.Primary)
        );

        await interaction.channel.send({
            embeds: [new EmbedBuilder().setColor(0xFFD1DC).setDescription(`${buyer}님, **${itemName} x ${itemQty}** 지급이 완료되었습니다.`)],
            components: [row]
        });
    }
});

client.login(TOKEN);
