const { Client, GatewayIntentBits, EmbedBuilder, ChannelType, PermissionFlagsBits, Collection, REST, Routes, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Loglar klasörünü oluştur
const logsDir = path.join(__dirname, 'loglar');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const logChannels = new Map();
client.commands = new Collection();

const commands = [
    {
        name: 'log',
        description: 'Log komutları',
        options: [
            {
                name: 'ekle',
                description: 'Belirtilen kanala log ekler',
                type: 1,
                options: [
                    {
                        name: 'kanal',
                        description: 'Log eklenecek kanal ismi',
                        type: 3,
                        required: true
                    }
                ]
            },
            {
                name: 'kaldir',
                description: 'Belirtilen kanaldan log takibini kaldırır',
                type: 1
            }
        ]
    }
];

const rest = new REST({ version: '10' }).setToken('MTM0NjMwNzU5MzMyODY2MDU5MA.GDFAoB.mcOEmtBIh_i6nJm_zdlyVfe0bSd5Si3xV4v8gg');

client.on('ready', async () => {
    console.log(`${client.user.tag} olarak giriş yapıldı!`);
    
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('Slash komutları başarıyla kaydedildi!');
    } catch (error) {
        console.error('Slash komutları kaydedilirken bir hata oluştu:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'log') {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'ekle') {
            const channelName = interaction.options.getString('kanal');

            // Sunucudaki tüm kategorileri al
            const categories = interaction.guild.channels.cache
                .filter(channel => channel.type === ChannelType.GuildCategory)
                .map(category => ({
                    label: category.name,
                    value: category.id,
                    description: `${category.children.cache.size} kanal`
                }));

            if (categories.length === 0) {
                return interaction.reply('Bu sunucuda hiç kategori bulunmuyor!');
            }

            const row = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('category_select')
                        .setPlaceholder('Bir kategori seçin')
                        .addOptions(categories)
                );

            const response = await interaction.reply({
                content: 'Lütfen kanalın ekleneceği kategoriyi seçin:',
                components: [row],
                fetchReply: true
            });

            try {
                const categoryInteraction = await response.awaitMessageComponent({
                    filter: i => i.user.id === interaction.user.id && i.customId === 'category_select',
                    time: 30000,
                    componentType: ComponentType.StringSelect
                });

                const selectedCategory = interaction.guild.channels.cache.get(categoryInteraction.values[0]);
                
                await categoryInteraction.update({
                    content: `${selectedCategory.name} kategorisi seçildi. Şimdi lütfen loglanacak mesajı gönderin.`,
                    components: []
                });

                const filter = m => m.author.id === interaction.user.id;
                const collector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });

                collector.on('collect', async (msg) => {
                    let targetChannel = interaction.guild.channels.cache.find(channel => 
                        channel.name.toLowerCase() === channelName.toLowerCase()
                    );

                    if (!targetChannel) {
                        try {
                            targetChannel = await interaction.guild.channels.create({
                                name: channelName,
                                type: ChannelType.GuildText,
                                parent: selectedCategory.id,
                                permissionOverwrites: [
                                    {
                                        id: interaction.guild.id,
                                        allow: [PermissionFlagsBits.ViewChannel],
                                    },
                                ],
                            });
                            await interaction.followUp(`${channelName} kanalı ${selectedCategory.name} kategorisinde oluşturuldu!`);
                        } catch (error) {
                            return interaction.followUp('Kanal oluşturulurken bir hata oluştu. Lütfen yetkilerimi kontrol edin.');
                        }
                    } else {
                        try {
                            await targetChannel.setParent(selectedCategory.id);
                            await interaction.followUp(`${channelName} kanalı ${selectedCategory.name} kategorisine taşındı!`);
                        } catch (error) {
                            return interaction.followUp('Kanal kategorisi güncellenirken bir hata oluştu.');
                        }
                    }

                    const embed = new EmbedBuilder()
                        .setColor('#FF5733')
                        .setTitle(channelName)
                        .setDescription(`\`\`\`${msg.content}\`\`\``)
                        .setAuthor({
                            name: interaction.guild.name,
                            iconURL: interaction.guild.iconURL({ dynamic: true })
                        })
                        .addFields(
                            { name: 'Kategori', value: `${selectedCategory.name}`, inline: true },
                            { name: 'Kanal', value: `${channelName}`, inline: true },
                            { name: 'Tarih', value: `${new Date().toLocaleString('tr-TR')}`, inline: true }
                        )
                        .setTimestamp()
                        .setFooter({
                            text: `${interaction.user.tag} tarafından gönderildi`,
                            iconURL: interaction.user.displayAvatarURL({ dynamic: true })
                        });

                    await targetChannel.send({ embeds: [embed] });
                    await interaction.followUp('Log başarıyla gönderildi!');

                    // Log dosyasına kaydet
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const logFileName = `${channelName}-${timestamp}.txt`;
                    const logFilePath = path.join(logsDir, logFileName);
                    
                    const logContent = `Sunucu: ${interaction.guild.name}
Kanal: ${channelName}
Kategori: ${selectedCategory.name}
Gönderen: ${interaction.user.tag}
Tarih: ${new Date().toLocaleString('tr-TR')}
Mesaj:
${msg.content}
----------------------------------------`;

                    fs.writeFileSync(logFilePath, logContent, 'utf8');

                    logChannels.set(channelName, {
                        categoryId: selectedCategory.id,
                        categoryName: selectedCategory.name,
                        logFile: logFilePath
                    });

                    // 5 saniye sonra tüm mesajları temizle
                    setTimeout(async () => {
                        try {
                            // Etkileşimin olduğu kanaldan son mesajları al ve sil
                            const messages = await interaction.channel.messages.fetch({ 
                                limit: 10 // Son 10 mesajı al
                            });
                            
                            const botMessages = messages.filter(m => 
                                m.author.id === client.user.id || // Bot'un mesajları
                                m.content === msg.content || // Kullanıcının log mesajı
                                m.interaction?.id === interaction.id // Komut etkileşimi
                            );
                            
                            await interaction.channel.bulkDelete(botMessages);
                        } catch (error) {
                            console.error('Mesajlar temizlenirken bir hata oluştu:', error);
                        }
                    }, 5000); // 5 saniye bekle
                });

                collector.on('end', collected => {
                    if (collected.size === 0) {
                        interaction.followUp('Zaman aşımı: Mesaj göndermediğiniz için işlem iptal edildi.').then(msg => {
                            setTimeout(() => msg.delete().catch(() => {}), 5000);
                        });
                    }
                });

            } catch (error) {
                if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
                    await interaction.followUp('Kategori seçimi zaman aşımına uğradı. Lütfen komutu tekrar kullanın.').then(msg => {
                        setTimeout(() => msg.delete().catch(() => {}), 5000);
                    });
                } else {
                    await interaction.followUp('Bir hata oluştu. Lütfen daha sonra tekrar deneyin.').then(msg => {
                        setTimeout(() => msg.delete().catch(() => {}), 5000);
                    });
                }
            }
        } 
        else if (subcommand === 'kaldir') {
            // Sunucudaki tüm metin kanallarını al
            const textChannels = interaction.guild.channels.cache
                .filter(channel => channel.type === ChannelType.GuildText)
                .map(channel => ({
                    label: channel.name,
                    value: channel.id,
                    description: channel.parent ? `${channel.parent.name} kategorisinde` : 'Kategorisiz'
                }));

            if (textChannels.length === 0) {
                return interaction.reply('Bu sunucuda hiç metin kanalı bulunmuyor!');
            }

            const row = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('channel_select')
                        .setPlaceholder('Silinecek kanalı seçin')
                        .addOptions(textChannels)
                );

            const response = await interaction.reply({
                content: 'Lütfen silmek istediğiniz kanalı seçin:',
                components: [row],
                fetchReply: true
            });

            try {
                const channelInteraction = await response.awaitMessageComponent({
                    filter: i => i.user.id === interaction.user.id && i.customId === 'channel_select',
                    time: 30000,
                    componentType: ComponentType.StringSelect
                });

                const selectedChannel = interaction.guild.channels.cache.get(channelInteraction.values[0]);

                try {
                    const channelName = selectedChannel.name;
                    const logData = logChannels.get(channelName);
                    
                    // Log dosyasını da sil
                    if (logData && logData.logFile && fs.existsSync(logData.logFile)) {
                        fs.unlinkSync(logData.logFile);
                    }
                    
                    await selectedChannel.delete();
                    logChannels.delete(channelName);
                    await channelInteraction.update({
                        content: `${channelName} kanalı başarıyla silindi!`,
                        components: []
                    });

                    // 5 saniye sonra mesajı temizle
                    setTimeout(async () => {
                        try {
                            const messages = await interaction.channel.messages.fetch({ 
                                limit: 5 
                            });
                            
                            const botMessages = messages.filter(m => 
                                m.author.id === client.user.id || 
                                m.interaction?.id === interaction.id
                            );
                            
                            await interaction.channel.bulkDelete(botMessages);
                        } catch (error) {
                            console.error('Mesajlar temizlenirken bir hata oluştu:', error);
                        }
                    }, 5000);
                } catch (error) {
                    await channelInteraction.update({
                        content: 'Kanal silinirken bir hata oluştu. Lütfen yetkilerimi kontrol edin.',
                        components: []
                    }).then(msg => {
                        setTimeout(() => msg.delete().catch(() => {}), 5000);
                    });
                }
            } catch (error) {
                if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
                    await interaction.followUp('Kanal seçimi zaman aşımına uğradı. Lütfen komutu tekrar kullanın.');
                } else {
                    await interaction.followUp('Bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
                }
            }
        }
    }
});

client.login('MTM0NjMwNzU5MzMyODY2MDU5MA.GDFAoB.mcOEmtBIh_i6nJm_zdlyVfe0bSd5Si3xV4v8gg'); 