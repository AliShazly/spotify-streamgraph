import { HashSet } from './hashset';
import { initDropArea } from './file-upload';
import * as d3 from 'd3';

/*

// https://github.com/curran/d3-area-label/blob/master/test/smallN.html
// https://www.d3-graph-gallery.com/graph/streamgraph_basic.html
// https://bl.ocks.org/curran/929c0cb58d5ec8dc1dceb7af20a33320
// https://stackoverflow.com/questions/39534831/d3-stack-streamgraph-not-curvy 

*/

export class AppState {
    private static singleton: AppState;
    constructor() {
        if (AppState.singleton) {
            return AppState.singleton;
        }
        AppState.singleton = this;
    }

    // no optional properties included
    allTracks: HashSet<TrackData, number> = new HashSet((track) => track.timestamp);

    // includes all optional properties
    allExtTracks: HashSet<TrackData, number> = new HashSet((track) => track.timestamp);

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

export interface ScoresAtTime {
    track: {
        [trackName: string]: number;
    };
    artist: {
        [artistName: string]: number;
    };
    album?: {
        [albumName: string]: number;
    };
    timestamp: number;
}

interface popularityData {
    scores: ScoresAtTime[];
    tracks: string[];
    artists: string[];
    albums?: string[];
}

function popularityOverTime(tracks: TrackData[], sliceLen: number, extended: boolean): popularityData {
    const sortedTracks = [...tracks].sort((a, b) => a.timestamp - b.timestamp);
    const allTrackNames = [...new Set(sortedTracks.map((track) => track.trackName))];
    const allArtists = [...new Set(sortedTracks.map((track) => track.artistName))];
    let allAlbums: string[] | undefined;
    if (extended) {
        allAlbums = [...new Set(sortedTracks.map((track) => track.albumName))];
    }

    const scores: ScoresAtTime[] = [];
    for (let i = 0; i < sortedTracks.length; i += sliceLen) {
        const chunkScores: ScoresAtTime = {
            track: Object.fromEntries(allTrackNames.map((i) => [i, 0])),
            artist: Object.fromEntries(allArtists.map((i) => [i, 0])),
            timestamp: sortedTracks[i].timestamp
        };
        if (extended) {
            chunkScores.album = Object.fromEntries(allAlbums.map((i) => [i, 0]));
        }

        sortedTracks.slice(i, i + sliceLen).forEach((track) => {
            chunkScores.track[track.trackName] += track.msPlayed;
            chunkScores.artist[track.artistName] += track.msPlayed;
            if (extended) {
                chunkScores.album[track.albumName] += track.msPlayed;
            }
        });
        scores.push(chunkScores);
    }

    const out: popularityData = {
        scores: scores,
        tracks: allTrackNames,
        artists: allArtists
    };
    if (extended) {
        out.albums = allAlbums;
    }
    return out;
}

const state = new AppState();
initDropArea(state);

document.getElementById('button').addEventListener('click', () => {
    if (state.readCount != 0) {
        alert('Reading files');
        return;
    }

    let popularity: popularityData;
    const slice_len = 1000;

    // if both extended and regular track data are uploaded, use the one with more entries
    if (state.allExtTracks.size > state.allTracks.size) {
        popularity = popularityOverTime([...state.allExtTracks.iter()], slice_len, true);
    } else {
        popularity = popularityOverTime([...state.allTracks.iter()], slice_len, false);
    }

    // formatted like https://github.com/d3/d3-shape#stack
    const data = popularity.scores.map((score) => {
        const artistScore = score.artist;
        artistScore.__timestamp = score.timestamp;
        return artistScore;
    });
    const keys = popularity.artists.sort(); //TODO: sort better than alphabetical

    console.log(keys, data);
    console.log(state.allExtTracks.size, state.allTracks.size);

    const svg = d3.select('svg');
    const width = +svg.attr('width');
    const height = +svg.attr('height');

    const x = d3
        .scaleLinear()
        .domain(d3.extent(data, (d) => d.__timestamp))
        .range([0, width]);

    let max = 0;
    Object.keys(data)
        .map((key) => data[key])
        .forEach((scores) => {
            keys.forEach((key) => {
                if (scores[key] > max) {
                    max = scores[key];
                }
            });
        });

    const y = d3
        .scaleLinear()
        .domain([-max, max * 2])
        .range([height, 0]);

    const color = d3
        .scaleOrdinal()
        .domain(keys)
        .range(keys.map(() => '#' + (0x1000000 + Math.random() * 0xffffff).toString(16).substring(1, 7)));

    const stackedData = d3.stack().offset(d3.stackOffsetWiggle).order(d3.stackOrderInsideOut).keys(keys)(data);

    svg.selectAll('layers')
        .data(stackedData)
        .join('path')
        .style('fill', (d) => (<any>color)(d.key))
        .attr(
            'd',
            <any>d3
                .area()
                .x((d) => x((<any>d).data.__timestamp))
                .y0((d) => y(d[0]))
                .y1((d) => y(d[1]))
        );
});
