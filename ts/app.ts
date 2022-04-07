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
    const loadingText = document.getElementById('loading-text');
    loadingText.style.display = 'inline';
    setTimeout(() => {
        drawGraph(tracks, extTracks);
        loadingText.style.display = 'none';
    }, 0);
});

document.getElementById('sample-button').addEventListener('click', () => {
    const loadingText = document.getElementById('loading-text');
    const inputSelection = document.getElementById('input-selection');
    fetch('sample.json')
        .then((res) => {
            if (res.ok) {
                inputSelection.style.display = 'none';
                loadingText.style.display = 'inline';
                return res.json();
            } else {
                return Promise.reject();
            }
        })
        .then((extTracks) => {
            drawGraph([], extTracks);
            loadingText.style.display = 'none';
        });
});
