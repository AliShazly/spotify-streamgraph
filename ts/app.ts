import { initDropArea } from './file-upload';
import { drawGraph } from './graph';

export class AppState {
    private static singleton: AppState;
    constructor() {
        if (AppState.singleton) {
            return AppState.singleton;
        }
        AppState.singleton = this;
    }

    // no optional properties included
    allTracks: TrackData[] = [];

    // includes all optional properties
    allExtTracks: TrackData[] = [];

    // number of file readers currently open
    readCount = 0;
}

export interface TrackData {
    trackName: string;
    artistName: string;
    albumName?: string;
    msPlayed: number;
    timestamp: number;
}

const state = new AppState();
initDropArea(state);
document.getElementById('button').addEventListener('click', () => {
    drawGraph(state);
});
