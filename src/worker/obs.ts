/* eslint-disable no-console */
import * as osn from "obs-studio-node";
import { BrowserWindow } from "electron";
import { Subject } from "rxjs";
import * as path from "path";
import * as fs from "fs";
import * as uuid from "uuid/v4";
import { IScene, ISceneItem, ITransition } from "obs-studio-node";
import { Slide } from "../app/_classes/slide";
import { supportedFiles } from "../app/_globals/supportedFilesFilters";
import { Store } from "../app/_helpers/store";
import { settingsStoreOptions } from "../app/_globals/settingsStoreOptions";
import { hexToRgb } from "../app/_helpers/hexToRgb";
import { AlignmentOptions } from "../app/_classes/alignmentOptions";
import { TransitionTypes } from "../app/_globals/transitionTypes";

const LOGO_SCENE_ID = "LOGOSCENE";

export class OBS {
    private obsInitialized = false;
    private signals: Subject<any> = new Subject();
    public previewWindow: BrowserWindow;
    private scenes: {
        id: string;
        scene: IScene;
    }[] = [];
    private settingsStore: Store;
    private transition: ITransition;

    constructor(parentWindow: BrowserWindow) {
        this.settingsStore = new Store(settingsStoreOptions);
        this.initialize(parentWindow);
    }

    // Init the library, launch OBS Studio instance, configure it, set up sources and scene
    private initialize(win: BrowserWindow) {
        if (this.obsInitialized) {
            console.warn("OBS is already initialized, skipping initialization.");
            return;
        }

        this.initOBS();
        this.configureOBS();
        this.setupSources(LOGO_SCENE_ID);
        this.setupPreview(win, LOGO_SCENE_ID);
        this.obsInitialized = true;

        setInterval(() => {
            try {
                win.webContents.send("performanceStatistics", osn.NodeObs.OBS_API_getPerformanceStatistics());
            } catch {
                //
            }
        }, 1000);
    }

    private initOBS() {
        console.debug("Initializing OBS...");
        osn.NodeObs.IPC.host("obs-studio-node-example"); // Usually some UUIDs go there
        osn.NodeObs.SetWorkingDirectory(path.join(__dirname, "../../node_modules/obs-studio-node"));

        const obsDataPath = path.join(__dirname, "../../osn-data"); // OBS Studio configs and logs
        const initResult = osn.NodeObs.OBS_API_initAPI("en-US", obsDataPath, "1.0.0");

        if (initResult !== 0) {
            const errorReasons = {
                "-2": "DirectX could not be found on your system. Please install the latest version of DirectX for your machine here <https://www.microsoft.com/en-us/download/details.aspx?id=35?> and try again.",
                "-5": "Failed to initialize OBS. Your video drivers may be out of date, or Streamlabs OBS may not be supported on your system.",
            };

            const errorMessage = errorReasons[initResult.toString()] || `An unknown error #${initResult} was encountered while initializing OBS.`;

            console.error("OBS init failure", errorMessage);

            this.shutdown();

            throw Error(errorMessage);
        }

        osn.NodeObs.OBS_service_connectOutputSignals((signalInfo) => {
            this.signals.next(signalInfo);
        });

        console.debug("OBS initialized");
    }

    private configureOBS() {
        console.debug("Configuring OBS");
        this.setSetting("Output", "Mode", "Simple");
        const availableEncoders = this.getAvailableValues("Output", "Recording", "RecEncoder");
        this.setSetting("Output", "RecEncoder", availableEncoders.slice(-1)[0] || "x264");
        this.setSetting("Output", "FilePath", path.join(__dirname, "../videos"));
        this.setSetting("Output", "RecFormat", "mkv");
        this.setSetting("Output", "VBitrate", 10000); // 10 Mbps
        this.setSetting("Video", "FPSCommon", 60);

        console.debug("OBS Configured");
    }

    private setupSources(sceneName: string) {
        const logoSource = osn.InputFactory.create("image_source", "logo", { file: path.join(__dirname, "../assets/icons/favicon.png") });
        // Set output video size to 1920x1080
        this.setVideoOutputResolution();

        // A scene is necessary here to properly scale captured screen size to output video size
        const scene = osn.SceneFactory.create(sceneName);
        const si = scene.add(logoSource);
        this.alignItem(si, {
            alignment: "center",
            padding: 50,
            scale: "fit",
        });

        this.transition = osn.TransitionFactory.create(TransitionTypes.Fade, "myTransition", {});
        this.transition.set(scene);
        osn.Global.setOutputSource(0, this.transition);
    }

    private setVideoOutputResolution() {
        const outputWidth = this.settingsStore.get("width");
        const outputHeight = this.settingsStore.get("height");
        this.setSetting("Video", "Base", `${outputWidth}x${outputHeight}`);
        this.setSetting("Video", "Output", `${outputWidth}x${outputHeight}`);
    }

    public updateSettings(parentWindow) {
        this.settingsStore = new Store(settingsStoreOptions);
        if (this.previewWindow) {
            this.setupProjector(parentWindow);
        }
        this.setVideoOutputResolution();
    }

    private alignItem(sceneItem: ISceneItem, options: AlignmentOptions) {
        const width = this.settingsStore.get("width");
        const height = this.settingsStore.get("height");
        const smallestSide = width < height ? width : height;
        const scale = Math.floor((smallestSide / sceneItem.source.width) * 100) / 100;
        sceneItem.scale = { x: scale, y: scale };

        if (width < height) {
            sceneItem.position = {
                x: 0,
                y: (height - (sceneItem.source.height * scale)) / 2,
            };
        } else if (width > height) {
            sceneItem.position = {
                x: (width - (sceneItem.source.width * scale)) / 2,
                y: 0,
            };
        }
    }

    public setupPreview(parentWindow: BrowserWindow, bounds) {
        osn.NodeObs.OBS_content_createSourcePreviewDisplay(
            parentWindow.getNativeWindowHandle(),
            "", // or use camera source Id here
            "previewDisplay",
        );
        osn.NodeObs.OBS_content_setShouldDrawUI("previewDisplay", false);

        return this.resizePreview(bounds);
    }

    public setupProjector(parentWindow) {
        const displayId = "projector";
        const displayWidth = Math.round(this.settingsStore.get("width") / 2);
        const displayHeight = Math.round(this.settingsStore.get("height") / 2);
        const resized = () => {
            const { width, height } = this.previewWindow.getContentBounds();
            osn.NodeObs.OBS_content_resizeDisplay(displayId, width, height + 20);
            osn.NodeObs.OBS_content_setPaddingSize(displayId, this.settingsStore.get("paddingSize"));
        };
        if (!this.previewWindow) {
            this.previewWindow = new BrowserWindow({
                width: displayWidth,
                height: displayHeight,
                parent: parentWindow,
                useContentSize: true,
            });
            this.previewWindow.on("close", () => {
                osn.NodeObs.OBS_content_destroyDisplay("projector");
                this.previewWindow = undefined;
            });
        } else {
            this.previewWindow.removeAllListeners("resize");
        }
        this.previewWindow.on("resize", resized);

        osn.NodeObs.OBS_content_createSourcePreviewDisplay(
            this.previewWindow.getNativeWindowHandle(),
            "", // or use camera source Id here
            displayId,
        );
        osn.NodeObs.OBS_content_setShouldDrawUI(displayId, true);
        osn.NodeObs.OBS_content_setPaddingColor(displayId, ...hexToRgb(this.settingsStore.get("backgroundColor")));
        resized();
    }

    public endProjector() {
        osn.NodeObs.OBS_content_destroyDisplay("projector");
        this.previewWindow.close();
        this.previewWindow = undefined;
    }

    public clearSlides() {
        // this.scenes[0].getItems().forEach((i) => i.remove());
    }

    public addFile(slide: Slide) {
        const realpath = fs.realpathSync(slide.filePath);
        let ext = realpath.split(".").splice(-1)[0];
        if (!ext) return null;
        ext = ext.toLowerCase();
        const filename = slide.filePath.split("\\").splice(-1)[0];

        for (const type of supportedFiles) {
            // eslint-disable-next-line no-continue
            if (!type.extensions.includes(ext)) continue;
            let settings = null;
            if (type.obsName === "image_source") {
                settings = { file: slide.filePath };
            } else if (type.obsName === "browser_source") {
                settings = {
                    // eslint-disable-next-line @typescript-eslint/camelcase
                    is_local_file: true,
                    // eslint-disable-next-line @typescript-eslint/camelcase
                    local_file: slide.filePath,
                };
            } else if (type.obsName === "ffmpeg_source") {
                settings = {
                    // eslint-disable-next-line @typescript-eslint/camelcase
                    is_local_file: true,
                    // eslint-disable-next-line @typescript-eslint/camelcase
                    local_file: slide.filePath,
                    looping: true,
                };
            } else if (type.obsName === "text_gdiplus") {
                settings = {
                    // eslint-disable-next-line @typescript-eslint/camelcase
                    read_from_file: true,
                    file: slide.filePath,
                };
            }
            if (settings) {
                const s = this.createSource("sourceId", type.obsName, settings);
                // const sceneItem = this.scenes[0].scene.add(s);
                const sceneId = Math.random().toString();
                const scene = osn.SceneFactory.create(sceneId);
                const si = scene.add(s);
                console.log(si);
                /* this.alignItem(si, {
                    alignment: "center",
                    padding: 50,
                    scale: "fit",
                }); */
                setTimeout(() => {
                    console.log("transition");
                    this.transitionTo(sceneId);
                    // ToDo, we need to wait for the video to load
                }, 1000);
                return s;
            }
        }
        return null;
    }

    private createSource(
        name: string,
        type: string,
        settings: any = {},
        options: any = {},
    ) {
        const id: string = options.sourceId || `${type}_${uuid()}`;
        const obsInputSettings = settings;
        const obsInput = osn.InputFactory.create(type, id, obsInputSettings);
        return obsInput;
    }

    private transitionTo(sceneName: string) {
        const scene = osn.SceneFactory.fromName(sceneName);
        this.transition.start(300, scene);
    }

    public shutdown() {
        if (!this.obsInitialized) {
            console.debug("OBS is already shut down!");
            return false;
        }

        console.debug("Shutting down OBS...");

        try {
            osn.NodeObs.OBS_service_removeCallback();
            osn.NodeObs.IPC.disconnect();
            this.obsInitialized = false;
        } catch (e) {
            throw Error(`Exception when shutting down OBS process${e}`);
        }

        console.debug("OBS shutdown successfully");

        if (this.previewWindow) {
            this.previewWindow.close();
        }
        return true;
    }

    private setSetting(category, parameter, value) {
        let oldValue;

        // Getting settings container
        const settings = osn.NodeObs.OBS_settings_getSettings(category).data;

        settings.forEach((subCategory) => {
            subCategory.parameters.forEach((param) => {
                if (param.name === parameter) {
                    oldValue = param.currentValue;
                    param.currentValue = value;
                }
            });
        });

        // Saving updated settings container
        if (value != oldValue) {
            osn.NodeObs.OBS_settings_saveSettings(category, settings);
        }
    }

    private getAvailableValues(category, subcategory, parameter) {
        const categorySettings = osn.NodeObs.OBS_settings_getSettings(category).data;
        if (!categorySettings) {
            console.warn(`There is no category ${category} in OBS settings`);
            return [];
        }

        const subcategorySettings = categorySettings.find(
            (sub) => sub.nameSubCategory === subcategory,
        );
        if (!subcategorySettings) {
            console.warn(`There is no subcategory ${subcategory} for OBS settings category ${category}`);
            return [];
        }

        const parameterSettings = subcategorySettings.parameters.find(
            (param) => param.name === parameter,
        );
        if (!parameterSettings) {
            console.warn(`There is no parameter ${parameter} for OBS settings category ${category}.${subcategory}`);
            return [];
        }

        return parameterSettings.values.map((value) => Object.values(value)[0]);
    }

    public resizePreview(bounds) {
        const { scaleFactor } = this.displayInfo();
        const displayWidth = Math.floor(bounds.width);
        const displayHeight = Math.round(bounds.height);
        const displayX = Math.floor(bounds.x);
        const displayY = Math.floor(bounds.y);

        osn.NodeObs.OBS_content_resizeDisplay("previewDisplay", displayWidth * scaleFactor, displayHeight * scaleFactor);
        osn.NodeObs.OBS_content_moveDisplay("previewDisplay", displayX * scaleFactor, displayY * scaleFactor);

        return { height: displayHeight };
    }

    private displayInfo() {
        // eslint-disable-next-line
        const { screen } = require("electron");
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.size;
        const { scaleFactor } = primaryDisplay;
        return {
            width,
            height,
            scaleFactor,
            aspectRatio: width / height,
            physicalWidth: width * scaleFactor,
            physicalHeight: height * scaleFactor,
        };
    }
}
