const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder
} = require("discord.js");
const { readPainelConfig } = require("./store");
const SISTEMAS = ["gifs", "avatar", "banners"];

function applyAppEmoji(button, emojiName) {
  try {
    const mention = global.getAppEmoji ? global.getAppEmoji(emojiName) : null;
    if (mention) button.setEmoji(mention);
  } catch {}
  return button;
}

function applyIfEmojiName(button, emojiName) {
  return emojiName ? applyAppEmoji(button, emojiName) : button;
}

function getSaudacaoPorHorario() {
  const hora = new Date().getHours();
  if (hora >= 5 && hora < 12) return "manha";
  if (hora >= 12 && hora < 18) return "tarde";
  return "noite";
}

function tituloSistema(tipo) {
  if (tipo === "gifs") return "GIFS";
  if (tipo === "avatar") return "AVATAR";
  return "BANNERS";
}

function formatCanal(channelId) {
  return channelId ? `<#${channelId}>` : "`Nao configurado`";
}

function addHeader(container, title, description) {
  container
    .setAccentColor(0xffffff)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}`));

  if (description) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(description));
  }

  return container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
  );
}

function buildPainelHomeContainer(user) {
  const saudacao = getSaudacaoPorHorario();

  const row1 = new ActionRowBuilder().addComponents(
    applyAppEmoji(
      new ButtonBuilder().setCustomId("painel:nav:canais").setLabel("Config. Canais").setStyle(ButtonStyle.Secondary),
      "textc"
    ),
    applyAppEmoji(
      new ButtonBuilder().setCustomId("painel:nav:gifs").setLabel("Config. Gifs").setStyle(ButtonStyle.Secondary),
      "settings2"
    ),
    applyAppEmoji(
      new ButtonBuilder().setCustomId("painel:nav:avatar").setLabel("Config. Avatar").setStyle(ButtonStyle.Secondary),
      "settings2"
    )
  );

  const row2 = new ActionRowBuilder().addComponents(
    applyAppEmoji(
      new ButtonBuilder().setCustomId("painel:nav:banners").setLabel("Config. Banners").setStyle(ButtonStyle.Secondary),
      "settings2"
    ),
    applyAppEmoji(
      new ButtonBuilder().setCustomId("painel:nav:servidores").setLabel("Config. Servidores").setStyle(ButtonStyle.Secondary),
      "thunder"
    )
  );

  const container = new ContainerBuilder();
  addHeader(container, "Painel de Configuracao", `Ola, ${user}, boa ${saudacao} seja bem vindo ao meu painel!`)
    .addActionRowComponents(row1)
    .addActionRowComponents(row2);

  return container;
}

function buildConfigCanaisContainer() {
  const config = readPainelConfig();

  const row1 = new ActionRowBuilder().addComponents(
    applyAppEmoji(new ButtonBuilder().setCustomId("painel:canal:gifs").setLabel("Canal de GIFS").setStyle(ButtonStyle.Secondary), "textc"),
    applyAppEmoji(new ButtonBuilder().setCustomId("painel:canal:avatar").setLabel("Canal de AVATAR").setStyle(ButtonStyle.Secondary), "textc"),
    applyAppEmoji(new ButtonBuilder().setCustomId("painel:canal:banners").setLabel("Canal de BANNERS").setStyle(ButtonStyle.Secondary), "textc")
  );

  const row2 = new ActionRowBuilder().addComponents(
    applyAppEmoji(new ButtonBuilder().setCustomId("painel:back:home").setLabel("Voltar").setStyle(ButtonStyle.Secondary), "back")
  );

  const container = new ContainerBuilder();
  addHeader(container, "Configuracao de canais", "Configure os canais onde serao enviado os GIFS, BANNERS e AVATAR")
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        `GIFS: ${formatCanal(config.canais.gifs)}`,
        `AVATAR: ${formatCanal(config.canais.avatar)}`,
        `BANNERS: ${formatCanal(config.canais.banners)}`
      ].join("\n"))
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(row1)
    .addActionRowComponents(row2);
  return container;
}

function buildConfigSistemaContainer(tipo) {
  const config = readPainelConfig();
  const sistema = config.sistemas[tipo];
  const nome = tituloSistema(tipo);
  const ligado = Boolean(sistema?.ligado);
  const toggleLabel = ligado ? "Ligado" : "Desligado";
  const toggleStyle = ligado ? ButtonStyle.Success : ButtonStyle.Secondary;
  const toggleEmoji = ligado ? "on" : "off";

  const row1 = new ActionRowBuilder().addComponents(
    applyAppEmoji(new ButtonBuilder().setCustomId(`painel:tempo:${tipo}`).setLabel("Tempo pra enviar").setStyle(ButtonStyle.Secondary), "time"),
    applyIfEmojiName(new ButtonBuilder().setCustomId(`painel:toggle:${tipo}`).setLabel(toggleLabel).setStyle(toggleStyle), toggleEmoji),
    applyAppEmoji(new ButtonBuilder().setCustomId("painel:back:home").setLabel("Voltar").setStyle(ButtonStyle.Secondary), "back")
  );

  const container = new ContainerBuilder();
  addHeader(container, `Configuracao do sistema de ${nome}`, `Configure o sistema de ${tipo} aqui.`)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        `Status: ${ligado ? "`Ligado`" : "`Desligado`"}`,
        `Tempo pra enviar: \`${sistema?.tempoSegundos ?? 60}\` segundo(s)`
      ].join("\n"))
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(row1);
  return container;
}

function buildServidoresRootContainer(client) {
  const cfg = readPainelConfig();
  const total = cfg.servidoresOrigens.length;

  const row1 = new ActionRowBuilder().addComponents(
    applyAppEmoji(
      new ButtonBuilder()
        .setCustomId("painel:srv:open_manage")
        .setLabel("Gerenciar Servidor")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(total === 0),
      "edit"
    ),
    applyAppEmoji(new ButtonBuilder().setCustomId("painel:srv:add").setLabel("Adicionar servidor").setStyle(ButtonStyle.Secondary), "green"),
    applyAppEmoji(
      new ButtonBuilder()
        .setCustomId("painel:srv:remove_open")
        .setLabel("Remover servidor")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(total === 0),
      "red"
    )
  );

  const row2 = new ActionRowBuilder().addComponents(
    applyAppEmoji(new ButtonBuilder().setCustomId("painel:back:home").setLabel("Voltar").setStyle(ButtonStyle.Secondary), "back")
  );

  const container = new ContainerBuilder();
  addHeader(container, "Gerenciar servidores", "Gerencie e Configure outros servidores onde o bot vai pegar as midias aqui:")
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`Servidores adicionados: \`${total}\``))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(row1)
    .addActionRowComponents(row2);
  return container;
}

function buildSelectServidorContainer(client) {
  const cfg = readPainelConfig();
  const options = cfg.servidoresOrigens.slice(0, 25).map((srv) => {
    const guildName = client.guilds.cache.get(srv.idServidor)?.name || `Servidor ${srv.idServidor}`;
    return new StringSelectMenuOptionBuilder()
      .setLabel(guildName.slice(0, 100))
      .setDescription(`ID: ${srv.idServidor}`.slice(0, 100))
      .setValue(srv.idServidor);
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId("painel:srv:select_manage")
    .setPlaceholder(options.length ? "Selecione um servidor" : "Nenhum servidor adicionado")
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(options.length === 0)
    .addOptions(options.length ? options : [new StringSelectMenuOptionBuilder().setLabel("Nenhum servidor").setValue("none")]);

  const rowSelect = new ActionRowBuilder().addComponents(select);
  const rowBack = new ActionRowBuilder().addComponents(
    applyAppEmoji(new ButtonBuilder().setCustomId("painel:nav:servidores").setLabel("Voltar").setStyle(ButtonStyle.Secondary), "back")
  );

  const container = new ContainerBuilder();
  addHeader(container, "Selecione o servidor que deseja gerenciar", "Escolha um servidor adicionado para abrir o gerenciamento.")
    .addActionRowComponents(rowSelect)
    .addActionRowComponents(rowBack);
  return container;
}

function getServidorOrigem(cfg, serverId) {
  return cfg.servidoresOrigens.find((s) => s.idServidor === serverId) || null;
}

function buildManageServidorContainer(client, serverId) {
  const cfg = readPainelConfig();
  const srv = getServidorOrigem(cfg, serverId);
  const guildName = client.guilds.cache.get(serverId)?.name || `Servidor ${serverId}`;
  const ligado = Boolean(srv?.ligado);

  const row1 = new ActionRowBuilder().addComponents(
    applyIfEmojiName(
      new ButtonBuilder()
        .setCustomId(`painel:srv:toggle:${serverId}`)
        .setLabel(ligado ? "Ligado" : "Desligado")
        .setStyle(ligado ? ButtonStyle.Success : ButtonStyle.Secondary),
      ligado ? "on" : "off"
    ),
    applyAppEmoji(new ButtonBuilder().setCustomId("painel:srv:open_manage").setLabel("Voltar").setStyle(ButtonStyle.Secondary), "back")
  );

  const container = new ContainerBuilder();
  addHeader(container, `Gerenciamento do servidor (${guildName})`, "Gerencie o estado do servidor selecionado.")
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `Status: ${ligado ? "`Ligado`" : "`Desligado`"}`,
      `GIFS origem: ${formatCanal(srv?.idCanalGifs)}`,
      `AVATAR origem: ${formatCanal(srv?.idCanalAvatar)}`,
      `BANNERS origem: ${formatCanal(srv?.idCanalBanners)}`
    ].join("\n")))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(row1);
  return container;
}

function buildRemoveServidorContainer(client) {
  const cfg = readPainelConfig();
  const options = cfg.servidoresOrigens.slice(0, 25).map((srv) => {
    const guildName = client.guilds.cache.get(srv.idServidor)?.name || `Servidor ${srv.idServidor}`;
    return new StringSelectMenuOptionBuilder()
      .setLabel(guildName.slice(0, 100))
      .setDescription(`Remover ${srv.idServidor}`.slice(0, 100))
      .setValue(srv.idServidor);
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId("painel:srv:select_remove")
    .setPlaceholder(options.length ? "Selecione um servidor para remover" : "Nenhum servidor")
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(options.length === 0)
    .addOptions(options.length ? options : [new StringSelectMenuOptionBuilder().setLabel("Nenhum servidor").setValue("none")]);

  const container = new ContainerBuilder();
  addHeader(container, "Remover servidor", "Selecione um servidor para remover e fazer o bot sair automaticamente.")
    .addActionRowComponents(new ActionRowBuilder().addComponents(select))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        applyAppEmoji(new ButtonBuilder().setCustomId("painel:nav:servidores").setLabel("Voltar").setStyle(ButtonStyle.Secondary), "back")
      )
    );
  return container;
}

function buildMediaDispatchContainer({ mediaUrl, serverName }) {
  const title = String(serverName || "Servidor");
  const container = new ContainerBuilder();
  addHeader(container, title, "");

  if (typeof MediaGalleryBuilder === "function" && typeof MediaGalleryItemBuilder === "function") {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(String(mediaUrl)).setDescription(title)
      )
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(String(mediaUrl)));
  }

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Download").setStyle(ButtonStyle.Link).setURL(String(mediaUrl))
    )
  );
  return container;
}

async function enviarPainelAdmin(interaction) {
  const payload = {
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    components: [buildPainelHomeContainer(interaction.user)]
  };

  if (interaction.deferred) {
    await interaction.editReply(payload);
    return;
  }

  if (interaction.replied) {
    await interaction.followUp(payload);
    return;
  }

  try {
    await interaction.reply(payload);
  } catch (error) {
    if (error?.code === 40060) {
      if (interaction.deferred) {
        await interaction.editReply(payload).catch(() => {});
      } else {
        await interaction.followUp(payload).catch(() => {});
      }
      return;
    }
    throw error;
  }
}

module.exports = {
  enviarPainelAdmin,
  getSaudacaoPorHorario,
  buildPainelHomeContainer,
  buildConfigCanaisContainer,
  buildConfigSistemaContainer,
  buildServidoresRootContainer,
  buildSelectServidorContainer,
  buildManageServidorContainer,
  buildRemoveServidorContainer,
  buildMediaDispatchContainer,
  SISTEMAS
};
