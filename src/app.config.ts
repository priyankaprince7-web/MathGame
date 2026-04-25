import {
    defineServer,
    defineRoom,
    monitor,
    playground,
    createRouter,
    createEndpoint,
} from "colyseus";

import { TournamentRoom } from "./rooms/TournamentRoom.js";

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