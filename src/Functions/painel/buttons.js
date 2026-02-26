const {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const {
  buildPainelHomeContainer,
  buildConfigCanaisContainer,
  buildConfigSistemaContainer,
  buildServidoresRootContainer,
  buildSelectServidorContainer,
  buildManageServidorContainer,
  buildRemoveServidorContainer,
  SISTEMAS
} = require("./painelA");
const { updatePainelConfig, readPainelConfig } = require("./store");

function isPainelSystem(tipo) {
  return SISTEMAS.includes(tipo);
}

async function openTempoModal(interaction, tipo) {
  const modal = new ModalBuilder()
    .setCustomId(`painel:modal_tempo:${tipo}`)
    .setTitle(`Tempo - ${tipo.toUpperCase()}`);

  const input = new TextInputBuilder()
    .setCustomId("tempo_segundos")
    .setLabel("Tempo em segundos")
    .setPlaceholder("Ex: 30")
    .setRequired(true)
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(5);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function openCanalModal(interaction, tipo) {
  const labels = { gifs: "GIFS", avatar: "AVATAR", banners: "BANNERS" };
  const modal = new ModalBuilder()
    .setCustomId(`painel:modal_canal:${tipo}`)
    .setTitle(`Canal - ${labels[tipo] || tipo.toUpperCase()}`);

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId("canal_id")
    .setPlaceholder("Selecione apenas 1 canal")
    .setMinValues(1)
    .setMaxValues(1)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

  const label = new LabelBuilder()
    .setLabel(`Canal de ${labels[tipo] || tipo}`)
    .setDescription("Selecione o canal onde o sistema vai enviar a midia.")
    .setChannelSelectMenuComponent(channelSelect);

  modal.addLabelComponents(label);
  await interaction.showModal(modal);
}

async function openAddServidorModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("painel:modal_srv_add")
    .setTitle("Adicionar servidor");

  const f1 = new TextInputBuilder().setCustomId("id_servidor").setLabel("ID do servidor").setStyle(TextInputStyle.Short).setRequired(true);
  const f2 = new TextInputBuilder().setCustomId("id_canal_gifs").setLabel("ID do canal de GIFS").setStyle(TextInputStyle.Short).setRequired(true);
  const f3 = new TextInputBuilder().setCustomId("id_canal_avatar").setLabel("ID do canal de AVATAR").setStyle(TextInputStyle.Short).setRequired(true);
  const f4 = new TextInputBuilder().setCustomId("id_canal_banners").setLabel("ID do canal de BANNERS").setStyle(TextInputStyle.Short).setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(f1),
    new ActionRowBuilder().addComponents(f2),
    new ActionRowBuilder().addComponents(f3),
    new ActionRowBuilder().addComponents(f4)
  );

  await interaction.showModal(modal);
}

async function handlePainelButton(interaction) {
  const { customId } = interaction;
  if (!customId.startsWith("painel:")) return false;

  if (customId === "painel:nav:canais") {
    await interaction.update({ components: [buildConfigCanaisContainer()] });
    return true;
  }

  if (customId === "painel:nav:servidores") {
    await interaction.update({ components: [buildServidoresRootContainer(interaction.client)] });
    return true;
  }

  if (customId === "painel:srv:open_manage") {
    await interaction.update({ components: [buildSelectServidorContainer(interaction.client)] });
    return true;
  }

  if (customId === "painel:srv:add") {
    await openAddServidorModal(interaction);
    return true;
  }

  if (customId === "painel:srv:remove_open") {
    await interaction.update({ components: [buildRemoveServidorContainer(interaction.client)] });
    return true;
  }

  if (customId.startsWith("painel:srv:toggle:")) {
    const serverId = customId.split(":")[3];
    updatePainelConfig((cfg) => {
      const srv = cfg.servidoresOrigens.find((s) => s.idServidor === serverId);
      if (srv) srv.ligado = !srv.ligado;
      return cfg;
    });
    await interaction.update({ components: [buildManageServidorContainer(interaction.client, serverId)] });
    return true;
  }

  if (customId === "painel:back:home") {
    await interaction.update({ components: [buildPainelHomeContainer(interaction.user)] });
    return true;
  }

  if (customId === "painel:back:canais") {
    await interaction.update({ components: [buildConfigCanaisContainer()] });
    return true;
  }

  if (customId.startsWith("painel:nav:")) {
    const tipo = customId.split(":")[2];
    if (!isPainelSystem(tipo)) return false;
    await interaction.update({ components: [buildConfigSistemaContainer(tipo)] });
    return true;
  }

  if (customId.startsWith("painel:canal:")) {
    const tipo = customId.split(":")[2];
    if (!isPainelSystem(tipo)) return false;
    await openCanalModal(interaction, tipo);
    return true;
  }

  if (customId.startsWith("painel:toggle:")) {
    const tipo = customId.split(":")[2];
    if (!isPainelSystem(tipo)) return false;

    updatePainelConfig((cfg) => {
      cfg.sistemas[tipo].ligado = !cfg.sistemas[tipo].ligado;
      return cfg;
    });

    await interaction.update({ components: [buildConfigSistemaContainer(tipo)] });
    return true;
  }

  if (customId.startsWith("painel:tempo:")) {
    const tipo = customId.split(":")[2];
    if (!isPainelSystem(tipo)) return false;
    await openTempoModal(interaction, tipo);
    return true;
  }

  return false;
}

module.exports = { handlePainelButton };
