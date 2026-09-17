import { dispatch, type Registry } from "./cli/router.js";
import { homeCommand, rootHelp } from "./commands/home.js";
import { listCommand } from "./commands/list.js";
import { showCommand } from "./commands/show.js";
import { createCommand } from "./commands/create.js";
import { promptCommand } from "./commands/prompt.js";
import { outputCommand } from "./commands/output.js";
import { closeCommand } from "./commands/close.js";
import { doctorCommand } from "./commands/doctor.js";
import { setupHooks, setupRemove, setupStatus } from "./commands/setup.js";

const registry: Registry = {
  tool: "crswd-axi",
  root: homeCommand,
  rootHelp,
  commands: {
    list: listCommand,
    show: showCommand,
    create: createCommand,
    prompt: promptCommand,
    output: outputCommand,
    close: closeCommand,
    doctor: doctorCommand,
    "setup hooks": setupHooks,
    "setup status": setupStatus,
    "setup remove": setupRemove,
  },
  aliases: {
    sessions: "list",
    ls: "list",
    destroy: "close",
    setup: "setup status",
  },
};

const code = await dispatch(registry, process.argv.slice(2));
process.exit(code);
