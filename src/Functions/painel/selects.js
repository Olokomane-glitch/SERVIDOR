const {
  buildConfigCanaisContainer,
  buildManageServidorContainer,
  buildRemoveServidorContainer
} = require("./painelA");
const { updatePainelConfig } = require("./store");

const VALID = new Set(["gifs", "avatar", "banners"]);

async function handlePainelSelect(interaction) {
  if (!interaction.isChannelSelectMenu() && !interaction.isStringSelectMenu()) return false;

  if (interaction.isChannelSelectMenu() && interaction.customId.startsWith("painel:select_channel:")) {
    const tipo = interaction.customId.split(":")[2];
    if (!VALID.has(tipo)) return false;

    const selectedId = interaction.values?.[0];
    if (!selectedId) {
      await interaction.reply({ content: "Nenhum canal selecionado.", ephemeral: true });
      return true;
    }

    updatePainelConfig((cfg) => {
      cfg.canais[tipo] = selectedId;
      return cfg;
    });

    await interaction.update({ components: [buildConfigCanaisContainer()] });
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "painel:srv:select_manage") {
    const serverId = interaction.values?.[0];
    if (!serverId || serverId === "none") {
      await interaction.reply({ content: "Nenhum servidor disponivel.", ephemeral: true });
      return true;
    }
    await interaction.update({ components: [buildManageServidorContainer(interaction.client, serverId)] });
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "painel:srv:select_remove") {
    const serverId = interaction.values?.[0];
    if (!serverId || serverId === "none") {
      await interaction.reply({ content: "Nenhum servidor disponivel.", ephemeral: true });
      return true;
    }

    updatePainelConfig((cfg) => {
      cfg.servidoresOrigens = cfg.servidoresOrigens.filter((s) => s.idServidor !== serverId);
      return cfg;
    });

    const guild = interaction.client.guilds.cache.get(serverId) || (await interaction.client.guilds.fetch(serverId).catch(() => null));
    if (guild) {
      await guild.leave().catch(() => {});
    }

    await interaction.update({ components: [buildRemoveServidorContainer(interaction.client)] });
    return true;
  }

  return false;
}

module.exports = { handlePainelSelect };
