const {
  buildConfigCanaisContainer,
  buildConfigSistemaContainer,
  buildServidoresRootContainer,
  SISTEMAS
} = require("./painelA");
const { updatePainelConfig } = require("./store");
const { ChannelType, MessageFlags } = require("discord.js");

async function updatePainelMessageOrReply(interaction, container) {
  if (typeof interaction.isFromMessage === "function" && interaction.isFromMessage()) {
    await interaction.update({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2, components: [container] });
    return;
  }
  await interaction.reply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2, components: [container] });
}

async function handlePainelModal(interaction) {
  if (!interaction.isModalSubmit()) return false;

  if (interaction.customId === "painel:modal_srv_add") {
    const idServidor = interaction.fields.getTextInputValue("id_servidor").trim();
    const idCanalGifs = interaction.fields.getTextInputValue("id_canal_gifs").trim();
    const idCanalAvatar = interaction.fields.getTextInputValue("id_canal_avatar").trim();
    const idCanalBanners = interaction.fields.getTextInputValue("id_canal_banners").trim();

    const guild = await interaction.client.guilds.fetch(idServidor).catch(() => null);
    if (!guild) {
      await interaction.reply({ content: "O bot nao esta nesse servidor ou o ID e invalido.", ephemeral: true });
      return true;
    }

    updatePainelConfig((cfg) => {
      const idx = cfg.servidoresOrigens.findIndex((s) => s.idServidor === idServidor);
      const item = { idServidor, idCanalGifs, idCanalAvatar, idCanalBanners, ligado: true };
      if (idx >= 0) cfg.servidoresOrigens[idx] = item;
      else cfg.servidoresOrigens.push(item);
      return cfg;
    });

    await updatePainelMessageOrReply(interaction, buildServidoresRootContainer(interaction.client));
    return true;
  }

  if (interaction.customId.startsWith("painel:modal_canal:")) {
    const tipo = interaction.customId.split(":")[2];
    if (!SISTEMAS.includes(tipo)) return false;

    const channels = interaction.fields.getSelectedChannels("canal_id", true, [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
    const selected = channels.first();
    if (!selected) {
      await interaction.reply({ content: "Nenhum canal selecionado.", ephemeral: true });
      return true;
    }

    updatePainelConfig((cfg) => {
      cfg.canais[tipo] = selected.id;
      return cfg;
    });

    await updatePainelMessageOrReply(interaction, buildConfigCanaisContainer());
    return true;
  }

  if (!interaction.customId.startsWith("painel:modal_tempo:")) return false;

  const tipo = interaction.customId.split(":")[2];
  if (!SISTEMAS.includes(tipo)) return false;

  const value = interaction.fields.getTextInputValue("tempo_segundos");
  const tempo = Number.parseInt(String(value).trim(), 10);

  if (!Number.isFinite(tempo) || tempo < 1) {
    await interaction.reply({ content: "Informe um tempo valido (minimo 1 segundo).", ephemeral: true });
    return true;
  }

  updatePainelConfig((cfg) => {
    cfg.sistemas[tipo].tempoSegundos = tempo;
    return cfg;
  });

  await updatePainelMessageOrReply(interaction, buildConfigSistemaContainer(tipo));
  return true;
}

module.exports = { handlePainelModal };
