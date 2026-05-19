import {
    defineServer,
    defineRoom,
    monitor,
    playground,
    createRouter,
    createEndpoint,
} from "colyseus";

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import { TournamentRoom } from "./rooms/TournamentRoom.js";
import { SinglePlayerControllerRoom } from "./rooms/SinglePlayerControllerRoom.js";
import { MultiplayerRoom } from "./rooms/MultiplayerRoom.js";

// Needed for proper path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = defineServer({
rooms: {
    tournament: defineRoom(TournamentRoom),
    singleplayer_controller: defineRoom(SinglePlayerControllerRoom),
    multiplayer: defineRoom(MultiplayerRoom),
},

    routes: createRouter({
        api_hello: createEndpoint("/api/hello", { method: "GET" }, async () => {
            return { message: "Hello World" };
        })
    }),

    express: (app) => {
        app.use(express.static(path.join(process.cwd(), "docs")));

        app.get("/hi", (req, res) => {
            res.send("It's time to kick ass and chew bubblegum!");
        });

        app.use("/monitor", monitor());

        if (process.env.NODE_ENV !== "production") {
            app.use("/", playground());
        }
    }
});

export default server;