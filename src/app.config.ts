import {
    defineServer,
    defineRoom,
    monitor,
    playground,
    createRouter,
    createEndpoint,
} from "colyseus";

import express from "express"; // 👈 ADD THIS
import path from "path";       // 👈 ADD THIS
import { fileURLToPath } from "url"; // 👈 ADD THIS

import { TournamentRoom } from "./rooms/TournamentRoom.js";

// Needed for proper path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = defineServer({
    rooms: {
        tournament: defineRoom(TournamentRoom)
    },

    routes: createRouter({
        api_hello: createEndpoint("/api/hello", { method: "GET" }, async () => {
            return { message: "Hello World" };
        })
    }),

    express: (app) => {

        // ✅ SERVE YOUR PHONE UI FROM /docs
        app.use(express.static(path.join(__dirname, "../docs")));

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