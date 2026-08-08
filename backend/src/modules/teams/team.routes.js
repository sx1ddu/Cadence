const express = require("express");
const validate = require("../../middleware/validate");
const { authenticate } = require("../../middleware/authenticate");
const controller = require("./team.controller");
const {
  createTeamSchema,
  updateTeamSchema,
  addMemberSchema,
  updateMemberRoleSchema,
} = require("./team.validation");

const router = express.Router();

router.use(authenticate);

router.get("/", controller.list);
router.post("/", validate(createTeamSchema), controller.create);
router.get("/:id", controller.getOne);
router.patch("/:id", validate(updateTeamSchema), controller.update);
router.delete("/:id", controller.remove);

router.post("/:id/members", validate(addMemberSchema), controller.addMember);
router.patch("/:id/members/:userId", validate(updateMemberRoleSchema), controller.updateMemberRole);
router.delete("/:id/members/:userId", controller.removeMember);

module.exports = router;
