const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");

function buildDispatchMediaPayload({ mediaUrl, displayUrl, downloadUrl, serverName, files }) {
  const title = String(serverName || "Servidor");
  const imageUrl = String(displayUrl || mediaUrl || "");
  const buttonUrl = String(downloadUrl || mediaUrl || imageUrl);

  const embed = new EmbedBuilder()
    .setColor(0x111222)
    .setTitle(title);

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Download")
      .setStyle(ButtonStyle.Link)
      .setURL(buttonUrl)
  );

  return {
    embeds: [embed],
    components: [row],
    files: Array.isArray(files) ? files : []
  };
}

module.exports = {
  buildDispatchMediaPayload
};
