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

    allTracks: HashSet<TrackData, number> = new HashSet((track) => track.timestamp);

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

function popularityOverTime(tracks: TrackData[], sliceLen: number): popularityData {
    console.log(tracks);
    const scores: ScoresAtTime[] = [];
    const sortedTracks = [...tracks].sort((a, b) => a.timestamp - b.timestamp);
    const allTrackNames = [...new Set(tracks.map((track) => track.trackName))];
    const allArtists = [...new Set(tracks.map((track) => track.artistName))];
    const allAlbums = [...new Set(tracks.map((track) => track.albumName))];
    const includeAlbums = !allAlbums.includes(undefined);

    for (let i = 0; i < sortedTracks.length; i += sliceLen) {
        const chunkScores: ScoresAtTime = {
            track: Object.fromEntries(allTrackNames.map((i) => [i, 0])),
            artist: Object.fromEntries(allArtists.map((i) => [i, 0])),
            album: includeAlbums ? Object.fromEntries([...allAlbums].map((i) => [i, 0])) : undefined,
            timestamp: sortedTracks[i].timestamp
        };
        sortedTracks.slice(i, i + sliceLen).forEach((track) => {
            chunkScores.track[track.trackName] += track.msPlayed;
            chunkScores.artist[track.artistName] += track.msPlayed;
            if (chunkScores.album) {
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
    if (!includeAlbums) {
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

    const popularity = popularityOverTime([...state.allTracks.iter()], 1000);

    // formatted like https://github.com/d3/d3-shape#stack
    const data = popularity.scores.map((score) => {
        const artistScore = score.artist;
        artistScore.__timestamp = score.timestamp;
        return artistScore;
    });
    const keys = popularity.artists;
    console.log(data, keys); // FIXME: keys array length changes with every call

    const svg = d3.select('svg');
    const width = +svg.attr('width');
    const height = +svg.attr('height');

    const x = d3
        .scaleLinear()
        .domain(d3.extent(data, (d) => d.__timestamp))
        .range([0, width]);
    svg.append('g').attr('transform', `translate(0, ${height})`).call(d3.axisBottom(x).ticks(5));

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
    svg.append('g').call(d3.axisLeft(y));

    const color = d3
        .scaleOrdinal()
        .domain(keys)
        .range(keys.map(() => '#' + (0x1000000 + Math.random() * 0xffffff).toString(16).substring(1, 7)));

    const stackedData = d3.stack().offset(d3.stackOffsetWiggle).order(d3.stackOrderInsideOut).keys(keys)(data);

    // @ts-ignore
    svg.selectAll('layers')
        .data(stackedData)
        .join('path')
        .style('fill', (d) => color(d.key))
        .attr(
            'd',
            // @ts-ignore
            d3
                .area()
                // @ts-ignore
                .x((d) => x(d.data.__timestamp))
                .y0((d) => y(d[0]))
                .y1((d) => y(d[1]))
        );
});
