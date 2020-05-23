export const supportedFiles: {
    extensions: string[];
    obsName: string;
    prettyName: string;
}[] = [
    {
        extensions: ["png", "jpg", "jpeg", "tga", "bmp"],
        prettyName: "Image files",
        obsName: "image_source",
    },
    {
        extensions: ["mp4", "ts", "mov", "flv", "mkv", "avi", "mp3", "ogg", "aac", "wav", "gif", "webm"],
        prettyName: "Video files",
        obsName: "ffmpeg_source",
    },
    {
        extensions: ["txt"],
        prettyName: "Text files",
        obsName: "text_gdiplus",
    },
    {
        extensions: ["html"],
        prettyName: "HTML files",
        obsName: "browser_source",
    },
];

export const supportedFilesFilters = supportedFiles.map(
    (f) => ({ name: f.prettyName, extensions: f.extensions }),
);
supportedFilesFilters.unshift({
    name: "All supported files",
    extensions: supportedFilesFilters.reduce((p, c) => { p.push(...c.extensions); return p; }, []),
});