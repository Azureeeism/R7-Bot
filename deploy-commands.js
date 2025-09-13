require("dotenv").config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits  } = require("discord.js");

const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;


const commands = [
  new SlashCommandBuilder()
    .setName("setign")
    .setDescription("Set an in-game name")
    .addUserOption(option =>
      option.setName("user")
        .setDescription("Discord user (leave empty to set your own IGN)")
        .setRequired(true) // user can be optional
    )
    .addStringOption(option =>
      option.setName("ign")
        .setDescription("In-game name")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("ign")
    .setDescription("Check a user's registered in-game name")
    .addUserOption(option =>
      option.setName("user")
        .setDescription("The user whose IGN you want to check")
        .setRequired(false) // if not provided, defaults to self
    ),
    new SlashCommandBuilder()
    .setName("guildmembers")
    .setDescription("Show all guild members and their IGN"),
  new SlashCommandBuilder()
  .setName("resetign")
  .setDescription("Reset a user's in-game name and nickname (Admin only)")
  .addUserOption(option =>
    option.setName("user")
      .setDescription("The Discord user to reset")
      .setRequired(true)
  ),
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);

(async () => {
  try {
    console.log("Started refreshing application (/) commands.");

    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands },
    );

    console.log("✅ Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error(error);
  }
})();