import { Injectable, NgZone } from "@angular/core";
import * as express from "express";
import { ShowService } from "./show.service";
import { RecentShowsService } from "./recent-shows.service";

@Injectable({
    providedIn: "root",
})
export class MobileService {
    private server: express.Express;
    public connectedMobiles: {
        device: {
            model: string;
            deviceType: string;
            os: string;
            osVersion: string;
            sdkVersion: string;
            language: string;
            manufacturer: string;
            uuid: string;
            region: string;
        };
    }[] = [];
    private expressRunning = false;
    constructor(
        private showService: ShowService,
        private recentShowsService: RecentShowsService,
        private zone: NgZone,
    ) { }

    public init(): void {
        (() => {
            if (this.expressRunning) {
                return;
            }
            this.server = express();
            this.server.use((req: any, res, next) => {
                let data = "";
                req.on("data", (chunk) => { data += chunk; });
                req.on("end", () => {
                    req.rawBody = data;
                    req.jsonBody = JSON.parse(data || "null");
                    next();
                });
            });
            const r = express.Router();
            r.post("/connect", (req: any, res) => {
                this.zone.run(() => {
                    this.connectedMobiles.push({
                        device: req.jsonBody.device,
                    });
                });
                res.send({ success: true });
            });
            r.get("/recentShows", (req: any, res) => {
                res.send(this.recentShowsService.get());
            });
            r.post("/openRecentShow", async (req: any, res) => {
                await this.showService.open(req.jsonBody.show);
                res.send({ success: true });
            });
            r.post("/disconnect", (req: any, res) => {
                this.zone.run(() => {
                    this.connectedMobiles = this.connectedMobiles.filter(
                        (d) => d.device.uuid !== req.jsonBody.deviceId,
                    );
                });
                res.send({ success: true });
            });
            r.get("/slides", async (req, res) => {
                res.send({
                    slides: this.showService.data.value?.slides || [],
                });
            });
            });
            this.server.use(r);
            this.server.listen(4574, () => {
                // eslint-disable-next-line no-console
                console.log("listening on port 4574");
                this.expressRunning = true;
            });
        })();
    }
}
