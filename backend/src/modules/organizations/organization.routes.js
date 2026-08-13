const express = require("express");
const validate = require("../../middleware/validate");
const { authenticate } = require("../../middleware/authenticate");
const controller = require("./organization.controller");
const { createOrganizationSchema, createSubTeamSchema } = require("./organization.validation");

const router = express.Router();

router.use(authenticate);

router.get("/", controller.list);
router.post("/", validate(createOrganizationSchema), controller.create);
router.get("/:id/teams", controller.listTeams);
router.post("/:id/teams", validate(createSubTeamSchema), controller.createTeam);

module.exports = router;
