const webhookService = require("./webhook.service");
const asyncHandler = require("../../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  const webhooks = await webhookService.listMyWebhooks(req.dbUser.id);
  res.json({ success: true, data: { webhooks } });
});

const create = asyncHandler(async (req, res) => {
  const webhook = await webhookService.createWebhook(req.dbUser.id, req.body);
  res.status(201).json({
    success: true,
    data: { webhook },
    message: "Save this secret now — it won't be shown again.",
  });
});

const update = asyncHandler(async (req, res) => {
  const webhook = await webhookService.updateWebhook(req.params.id, req.dbUser.id, req.body);
  res.json({ success: true, data: { webhook } });
});

const remove = asyncHandler(async (req, res) => {
  await webhookService.deleteWebhook(req.params.id, req.dbUser.id);
  res.json({ success: true, message: "Webhook deleted." });
});

const listDeliveries = asyncHandler(async (req, res) => {
  const deliveries = await webhookService.listDeliveries(req.params.id, req.dbUser.id);
  res.json({ success: true, data: { deliveries } });
});

module.exports = { list, create, update, remove, listDeliveries };
