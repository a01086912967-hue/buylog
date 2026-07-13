const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const config = require('./config.json');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

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
        const channel = guild.channels.cache.get('1457384179535712473'); // 수정된 후기 채널 ID
        
        if (channel) {
            await channel.send({ 
                embeds: [new EmbedBuilder()
                    .setColor(0xFFD1DC)
                    .setTitle("✨ 새로운 구매 후기")
                    .setDescription(review)
                    .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() }) // 프로필 사진 추가
                    .addFields({ name: '작성자 멘션', value: `${interaction.user}` }) // 멘션 추가
                    .setFooter({ text: `작성자: ${interaction.user.tag}` })
                    .setTimestamp()] 
            });
            return await interaction.reply({ content: '후기가 성공적으로 등록되었습니다!', ephemeral: true });
        } else {
            return await interaction.reply({ content: '오류: 후기 채널을 찾을 수 없습니다.', ephemeral: true });
        }
    }

    // 3. 지급완료 명령어 처리
    if (interaction.isChatInputCommand() && interaction.commandName === '지급완료') {
        await interaction.reply({ content: '처리를 시작합니다.', ephemeral: true });

        const messages = await interaction.channel.messages.fetch({ limit: 100 });
        const msgs = Array.from(messages.values()).reverse();
        let fullContext = msgs.map(m => m.content + "\n" + m.embeds.map(e => (e.title || "") + "\n" + (e.description || "")).join("\n")).join("\n");
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

        // 로그 채널 (기존 디자인 유지)
        const logChannel = interaction.guild.channels.cache.get(config.purchaseLogChannelId);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setColor(0xFFD1DC)
                .setImage('https://i.imgur.com/jokl6LQ.gif')
                .setDescription(`${buyer} 님, **${itemName} x ${itemQty}** 구매 감사합니다.\n\n사용 금액: ${amount}\n담당 판매자: ${seller}`)
                .setFooter({ text: "sodx shop" }).setTimestamp();
            logChannel.send({ embeds: [logEmbed] });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('write_review').setLabel('구매 후기 작성').setStyle(ButtonStyle.Primary)
        );

        // DM 시도
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor(0xFFD1DC)
                .setTitle("<a:check:1518257176811012217> 구매 완료")
                .setDescription(`구매하신 **(${itemName} × ${itemQty})** 지급이 완료되었습니다!\n이용해 주셔서 감사합니다. <a:Twinkle_heart:1477354232045768804>\n\n아래 버튼을 눌러 후기를 작성해 주세요.`);
            
            await buyer.send({ embeds: [dmEmbed], components: [row] });
        } catch (e) {
            await interaction.channel.send({
                content: `⚠️ ${buyer} 님께 DM 전송이 제한되어 있어 이곳에 안내드립니다.\n**${itemName} x ${itemQty}** 지급이 완료되었습니다. 아래 버튼을 눌러 후기를 작성해주세요!`,
                components: [row]
            });
        }
    }
});

client.login(config.token);