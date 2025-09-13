require('dotenv').config();
const { Client, Events, GatewayIntentBits, Partials,  } = require('discord.js');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); // If using Node <18, otherwise native fetch works
const sharp = require('sharp');
const Database = require('better-sqlite3');
const { google } = require("googleapis");
const credentials = require("./service-account.json");

const imagePath = './screenshot.png';
const guild_db = new Database('guild.db');

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = "1JU6WvWKzioHF0ArfTM7n2rWJPkx5MdC7Adv0wCKksM4";

guild_db.prepare(`
  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,      -- Discord User ID
    ign TEXT                  -- In-game name
  )
`).run();

module.exports = guild_db;

async function preprocess(inputPath, outputPath) {
  await sharp(inputPath)
    .grayscale()              // convert to grayscale
    .normalise()              // normalize brightness/contrast
    .toFile(outputPath);      // save processed file
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,            // required for slash commands
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, readyClient => {
	console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

const sourceChannelId = "1379719411534925917"; // Channel 1
const destinationChannelId = "1416330476443930714"; // Channel 2

const row = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('button1')
      .setLabel('Reject')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('button2')
      .setLabel('Verify')
      .setStyle(ButtonStyle.Primary)
  );

const setIgnStmt = guild_db.prepare(`
  INSERT INTO members (id, ign) VALUES (@id, @ign)
  ON CONFLICT(id) DO UPDATE SET ign = @ign
`);
  

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const destinationChannel = await client.channels.fetch(destinationChannelId);
  if (!destinationChannel) return;

  // Check if message has image attachments
  if (message.attachments.size > 0) {
    for (const attachment of message.attachments.values()) {
      if (!attachment.contentType?.startsWith('image')) continue;

      try {
        // Download image temporarily

		
        // Download image temporarily
		const imagePath = path.join(__dirname, 'temp.png');
		const processedPath = path.join(__dirname, 'temp-processed.png');
		const response = await fetch(attachment.url);
		const buffer = Buffer.from(await response.arrayBuffer());
		fs.writeFileSync(imagePath, buffer);

		// Preprocess with sharp
		await preprocess(imagePath, processedPath);

		// Run OCR on the processed file
		const { data: { text } } = await Tesseract.recognize(processedPath, 'eng', {
		tessedit_char_whitelist: '0123456789,.:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '
		});

        // Extract Growth Rate (comma-friendly)
		const match = text.match(/growth\s*rate[:\s]*([\d,]+)/i);

        if (match) {
			const growthRate = match[1].replace(/,/g, '');
			
			// Send message with buttons and store it
			const sentMessage = await destinationChannel.send({
				content: `<@${message.author.id}>\nGrowth Rate: **${growthRate}**`,
				files: [attachment.url], // attach original image
				components: [row]        // buttons row
			});

			// Set up collector on the message
			// inside your messageCreate, after sending sentMessage with buttons
			const collector = sentMessage.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 300000 // 5 minutes
			});

			collector.on('collect', async (interaction) => {
			if (interaction.user.id !== message.author.id) {
				return interaction.reply({ content: "You cannot interact with this.", ephemeral: true });
			}

			// Disable both buttons
			const disabledRow = new ActionRowBuilder()
				.addComponents(
				new ButtonBuilder()
					.setCustomId('button1')
					.setLabel('Reject')
					.setStyle(ButtonStyle.Danger)
					.setDisabled(true),
				new ButtonBuilder()
					.setCustomId('button2')
					.setLabel('Verify')
					.setStyle(ButtonStyle.Primary)
					.setDisabled(true)
				);

			if (interaction.customId === 'button1') {
				await interaction.update({ content: `<@${message.author.id}>'s Growth Rate was rejected!`, components: [disabledRow] });
				collector.stop();
				return;
			}

			if (interaction.customId === 'button2') {
				// Get user IGN from your database
				const row = guild_db.prepare(`SELECT ign FROM members WHERE id = ?`).get(message.author.id);
				const ign = row?.ign;

				if (!ign) {
				await interaction.reply({ content: "You don't have an IGN set. Use `/setign` first.", ephemeral: true });
				return;
				}

				try {
				// Fetch current sheet data
				const sheetData = await sheets.spreadsheets.values.get({
					spreadsheetId: SPREADSHEET_ID,
					range: 'Members!A:B' // Assuming Column A = IGN, Column B = Growth Rate
				});

				const values = sheetData.data.values || [];
				let found = false;

				for (let i = 0; i < values.length; i++) {
					if (values[i][0] === ign) {
					// Update existing row
					values[i][1] = growthRate;
					found = true;
					break;
					}
				}

				if (!found) {
					// Add new row
					values.push([ign, growthRate]);
				}

				// Write back to sheet
				await sheets.spreadsheets.values.update({
					spreadsheetId: SPREADSHEET_ID,
					range: 'Members!A:B',
					valueInputOption: 'USER_ENTERED',
					requestBody: { values }
				});

				await interaction.update({ content: `✅ <@${message.author.id}>'s Growth Rate has been verified and updated in the sheet!`, components: [disabledRow] });
				} catch (err) {
				console.error(err);
				await interaction.reply({ content: "❌ Failed to update Google Sheet.", ephemeral: true });
				}

				collector.stop();
			}
			});

			}


        fs.unlinkSync(imagePath); // Delete temp image
      } catch (err) {
        console.error(err);
        destinationChannel.send(
          `Error processing image from <@${message.author.id}>.`
        );
      }
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

	if (interaction.commandName === "setign") {
  const targetUser = interaction.options.getUser("user") || interaction.user;
  const ign = interaction.options.getString("ign");

  try {
    // Save IGN in database
    setIgnStmt.run({ id: targetUser.id, ign });

    // Fetch the guild member
    const member = await interaction.guild.members.fetch(targetUser.id);

    // Format nickname as [IGN] username
    const formattedNick = `[R7] ${ign}`;

    // Update nickname
    await member.setNickname(formattedNick).catch(err => {
      console.warn(`Could not change nickname for <@${targetUser.id}>:`, err.message);
    });

    if (targetUser.id === interaction.user.id) {
      await interaction.reply({
        content: `Your IGN has been set to: \`${ign}\`\n📝 Your nickname was updated to **${formattedNick}**.`,
        ephemeral: true
      });
    } else {
      await interaction.reply({
        content: `IGN for **<@${targetUser.id}>** has been set to: \`${ign}\`\n📝 Their nickname was updated to **${formattedNick}**.`,
        ephemeral: true
      });
    }
  } catch (err) {
    console.error(err);
    await interaction.reply({
      content: "Failed to set IGN, please try again later.",
      ephemeral: true
    });
  }
}

   if (interaction.commandName === "ign") {
    const targetUser = interaction.options.getUser("user") || interaction.user;

    try {
      const row = guild_db
        .prepare(`SELECT ign FROM members WHERE id = ?`)
        .get(targetUser.id);

      if (row && row.ign) {
        if (targetUser.id === interaction.user.id) {
          await interaction.reply({
            content: `Your registered IGN is: \`${row.ign}\``,
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: `IGN for **<@${targetUser.tag}>** is: \`${row.ign}\``,
            ephemeral: true
          });
        }
      } else {
        if (targetUser.id === interaction.user.id) {
          await interaction.reply({
            content: `You haven’t set an IGN yet. Use \`/setign ign:<your_name>\` to register.`,
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: `**<@${targetUser.id}>** has not set an IGN yet.`,
            ephemeral: true
          });
        }
      }
    } catch (err) {
      console.error(err);
      await interaction.reply({
        content: "Could not fetch IGN, please try again later.",
        ephemeral: true
      });
    }
	
    }
  if (interaction.commandName === "guildmembers") {
	const rows = guild_db.prepare("SELECT * FROM members").all();

	if (rows.length === 0) {
		await interaction.reply({ content: "No members found in the guild database.", ephemeral: true });
		return;
	}

	let memberList = rows.map(row => `**<@${row.id}>** → ${row.ign}`).join("\n");

	await interaction.reply({ content: `**Guild Members List:**\n${memberList}`, ephemeral: true });
	}
	if (interaction.commandName === "resetign") {
  // check if user has admin permission
  if (!interaction.member.permissions.has("Administrator")) {
		await interaction.reply({ content: "❌ You don’t have permission to use this command.", ephemeral: true });
		return;
	}

	const user = interaction.options.getUser("user");

	// Remove from DB
	guild_db.prepare("DELETE FROM members WHERE id = ?").run(user.id);

	// Reset nickname
	try {
		const member = await interaction.guild.members.fetch(user.id);
		await member.setNickname(null); // null resets nickname to original username
	} catch (err) {
		console.error("Error resetting nickname:", err);
	}

	await interaction.reply({ content: `✅ IGN and nickname reset for <@${user.id}>.`, ephemeral: false });
	}
});


 

client.login(BOT_TOKEN);