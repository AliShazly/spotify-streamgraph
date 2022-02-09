import { initDropArea } from './file-upload';
import * as d3 from 'd3';

/*

// https://github.com/curran/d3-area-label/blob/master/test/smallN.html
// https://www.d3-graph-gallery.com/graph/streamgraph_basic.html
// https://bl.ocks.org/curran/929c0cb58d5ec8dc1dceb7af20a33320

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

interface ScoresAtTime {
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

function popularityOverTime(
    tracks: TrackData[],
    timeStepMs: number,
    extended: boolean
): popularityData {
    if (tracks.length == 0) {
        return {
            scores: [],
            tracks: [],
            artists: []
        };
    }

    const sortedTracks = [...tracks].sort((a, b) => a.timestamp - b.timestamp);
    const allTrackNames = [...new Set(sortedTracks.map((track) => track.trackName))];
    const allArtists = [...new Set(sortedTracks.map((track) => track.artistName))];
    let allAlbums: string[] | undefined = undefined;
    if (extended) {
        allAlbums = [...new Set(sortedTracks.map((track) => track.albumName))];
    }

    let lastIdx = 0;
    let currentTime = sortedTracks[0].timestamp;
    const endTime = sortedTracks[sortedTracks.length - 1].timestamp;
    const scores: ScoresAtTime[] = [];
    while (currentTime <= endTime) {
        const chunkScores: ScoresAtTime = {
            track: Object.fromEntries(allTrackNames.map((i) => [i, 0])),
            artist: Object.fromEntries(allArtists.map((i) => [i, 0])),
            timestamp: sortedTracks[lastIdx].timestamp
        };
        if (extended) {
            chunkScores.album = Object.fromEntries(allAlbums.map((i) => [i, 0]));
        }

        for (const [idx, track] of sortedTracks.slice(lastIdx, undefined).entries()) {
            if (track.timestamp >= currentTime && track.timestamp <= currentTime + timeStepMs) {
                chunkScores.track[track.trackName] += track.msPlayed;
                chunkScores.artist[track.artistName] += track.msPlayed;
                if (extended) {
                    chunkScores.album[track.albumName] += track.msPlayed;
                }
            } else {
                lastIdx += idx;
                scores.push(chunkScores);
                break;
            }
        }
        currentTime += timeStepMs;
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
    // if both extended and regular track data are uploaded, use the one with more entries
    if (state.allExtTracks.length > state.allTracks.length) {
        popularity = popularityOverTime(state.allExtTracks, 2629800000, true);
    } else {
        popularity = popularityOverTime(state.allTracks, 2629800000, false);
    }

    // formatted like https://github.com/d3/d3-shape#stack
    interface DataPoint {
        [name: string]: number;
        __timestamp: number;
    }
    const data: DataPoint[] = popularity.scores.map((score) => {
        const artistScore: { [name: string]: number } = score.artist;
        artistScore.__timestamp = score.timestamp;
        return artistScore as DataPoint;
    });
    const keys = popularity.artists;
    console.log(keys, data);

    // TODO: margin: https://bl.ocks.org/mbostock/3019563

    const svg = d3.select('svg');
    const width = +svg.attr('width');
    const height = +svg.attr('height');

    const stackedData = d3
        .stack()
        .offset(d3.stackOffsetWiggle)
        .order(d3.stackOrderInsideOut)
        .keys(keys)(data);

    const x = d3
        .scaleTime()
        .domain(d3.extent(data, (d) => new Date(d.__timestamp)))
        .range([0, width]);
    const xAxis = d3.axisBottom(x).ticks(d3.timeYear.every(1));

    const y = d3
        .scaleLinear()
        .domain([
            d3.min(stackedData, (series) => d3.min(series, (d) => d[0])),
            d3.max(stackedData, (series) => d3.max(series, (d) => d[1]))
        ])
        .range([height, 0]);

    const color = d3
        .scaleOrdinal()
        .domain(keys)
        .range(
            keys.map(
                () => '#' + (0x1000000 + Math.random() * 0xffffff).toString(16).substring(1, 7)
            )
        );

    let selectedKey: string | null = null;
    const graphGrp = svg.append('g');
    graphGrp
        .selectAll('layers')
        .data(stackedData)
        .enter()
        .append('path')
        .classed('filledArea', true)
        .style('fill', (d) => String(color(d.key)))
        .attr('shape-rendering', 'geometricPrecision')
        .style('vector-effect', 'non-scaling-stroke')
        .attr(
            'd',
            <any>d3
                .area()
                .x((d: any) => x(d.data.__timestamp))
                .y0((d) => y(d[0]))
                .y1((d) => y(d[1]))
                .curve(d3.curveBasis)
        )
        .on('click', (ev, d) => {
            const target = d3.select(ev.target);
            if (target.classed('selectedArea')) {
                selectedKey = null;
                target.classed('selectedArea', false);
                tooltip.style('opacity', 0);
                d3.selectAll('.filledArea').style('opacity', 1).style('stroke', 'none');
            } else {
                selectedKey = d.key;
                tooltip.style('opacity', 1);
                tooltip.text(selectedKey);
                d3.selectAll('.filledArea')
                    .classed('selectedArea', false)
                    .style('stroke', 'none')
                    .style('opacity', 0.2);
                target.classed('selectedArea', true).style('stroke', 'black').style('opacity', 1);
            }
        });

    const gX = svg
        .append('g')
        .attr('transform', `translate(0,${height - 25})`)
        .style('font-size', '11px')
        .call(xAxis);

    const tooltip = svg
        .append('text')
        .attr('x', 50)
        .attr('y', 50)
        .style('opacity', '0')
        .style('font-size', '24px');

    const zoom = d3
        .zoom()
        // FIXME: extents not enforced with zoom.transform
        .scaleExtent([1, 5])
        .translateExtent([
            [0, 0],
            [width, height]
        ])
        .filter(() => false) // no auto zoom / pan
        .on('zoom', (ev) => {
            const { transform } = ev;
            graphGrp.attr('transform', transform);
            gX.call(xAxis.scale(transform.rescaleX(x)));
        });
    svg.call(zoom);

    const zoomRect = svg
        .append('rect')
        .style('fill', 'white')
        .style('stroke', 'black')
        .style('opacity', 0);
    let [zoomRectInitX, zoomRectInitY] = [0, 0];

    svg.on('mousedown', (ev) => {
        [zoomRectInitX, zoomRectInitY] = d3.pointer(ev, svg.node());
        zoomRect
            .attr('x', zoomRectInitX)
            .attr('y', zoomRectInitY)
            .attr('width', 0)
            .attr('height', 0)
            .style('opacity', 0.8);
    })
        .on('mousemove', (ev) => {
            if (selectedKey != null) {
                const lerp = (a: number, b: number, t: number): number => (1 - t) * a + t * b;
                const fltIdx = (d3.pointer(ev, graphGrp.node())[0] / width) * (data.length - 1);
                if (fltIdx >= 0 && fltIdx <= data.length - 1) {
                    const minsListened = Math.round(
                        lerp(
                            data[Math.floor(fltIdx)][selectedKey],
                            data[Math.ceil(fltIdx)][selectedKey],
                            fltIdx - Math.floor(fltIdx)
                        ) / 60_000
                    );

                    // TODO: display in hrs/mins/secs
                    tooltip.text(`${selectedKey} : ${minsListened}`);
                }
            }

            if (ev.buttons > 0) {
                const [mouseX, mouseY] = d3.pointer(ev, svg.node());
                zoomRect
                    .attr('x', Math.min(zoomRectInitX, mouseX))
                    .attr('y', Math.min(zoomRectInitY, mouseY))
                    .attr('width', Math.abs(zoomRectInitX - mouseX))
                    .attr('height', Math.abs(zoomRectInitY - mouseY));
            }
        })
        .on('mouseup', (ev) => {
            zoomRect.style('opacity', 0);
            // if the target is a filledArea, we let the graphGrp onClick handle it
            // while dragging, the ev target will always be the zoomRect
            // the target will only be a filledArea on a click
            if (!d3.select(ev.target).classed('filledArea')) {
                const curTransform = d3.zoomTransform(graphGrp.node() as Element);

                // if zoomRect is tiny or we're already zoomed in, reset zoom
                // TODO: impl zooming when already zoomed in, based on curTransform
                if (
                    (+zoomRect.attr('width') < 5 && +zoomRect.attr('height') < 5) ||
                    curTransform.x != 0 ||
                    curTransform.y != 0 ||
                    curTransform.k != 1
                ) {
                    graphGrp
                        .transition()
                        .duration(1000)
                        .call(<any>zoom.transform, d3.zoomIdentity);
                } else {
                    const [zoomX, zoomY, zoomWidth, zoomHeight] = [
                        +zoomRect.attr('x'),
                        +zoomRect.attr('y'),
                        +zoomRect.attr('width'),
                        +zoomRect.attr('height')
                    ];

                    const scale = 1 / Math.max(zoomWidth / width, zoomHeight / height);
                    const [svgCenterX, svgCenterY] = [width / 2, height / 2];
                    const [zoomCenterX, zoomCenterY] = [
                        zoomX + zoomWidth / 2,
                        zoomY + zoomHeight / 2
                    ];
                    const [relX, relY] = [svgCenterX - zoomCenterX, svgCenterY - zoomCenterY];
                    const transform = d3.zoomIdentity
                        //https://stackoverflow.com/questions/43184515/d3-js-v4-zoom-to-chart-center-not-mouse-position
                        .translate(
                            svgCenterX - (2 * svgCenterX * scale) / 2,
                            svgCenterY - (2 * svgCenterY * scale) / 2
                        )
                        .scale(scale)
                        .translate(relX, relY);

                    graphGrp
                        .transition()
                        .duration(1000)
                        .call(<any>zoom.transform, transform)
                        .on('end', () => {
                            //TODO: force redraw of svg
                        });
                }
            }
        })
        .on('mouseout', () => tooltip.text(selectedKey));
});
