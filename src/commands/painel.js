const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { enviarPainelAdmin } = require("../Functions/painel/painelA");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("painel")
    .setDescription("----")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const isAdmin = interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    );

    if (!isAdmin) {
      await interaction.reply({
        content: "<:red:1475567069918400562> | Você precisa ser um administrador para usar este comando.",
        ephemeral: true
      });
      return;
    }

    await enviarPainelAdmin(interaction);
  }
};
