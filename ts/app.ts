import { initDropArea } from './file-upload';
import { drawGraph } from './graph';

export interface TrackData {
    trackName: string;
    artistName: string;
    albumName?: string;
    msPlayed: number;
    timestamp: number;
}

initDropArea((tracks, extTracks) => {
    document.getElementById('input-selection').style.display = 'none';
    drawGraph(tracks, extTracks);
});

document.getElementById('sample-button').addEventListener('click', () => {
    document.getElementById('input-selection').style.display = 'none';
    // read local storage for sample data
    // drawGraph(tracks,extTracks);
});
