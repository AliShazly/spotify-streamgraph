import { TrackData } from './app';
import * as d3 from 'd3';
import { WebglCtx, TriangulatedArea } from '../pkg';

const SECOND = 1000;
const MINUTE = SECOND * 60;

const WIDTH = 1500;
const HEIGHT = 500;
const SELECTION_STROKE_W = 1.5;
const OVERLAY_LINE_W = 2;
const TRANSITION_DUR = SECOND * 0.8;

interface ScoresAtTime {
    scores: {
        [key: string]: number;
    };
    timestamp: number;
}

interface RawDataPoint {
    key: string;
    score: number;
    timestamp: number;
}

interface PopularityOverTime {
    scores: ScoresAtTime[];
    keys: string[];
}

function popularityOverTime(
    tracks: RawDataPoint[],
    timeStepMs: number
): PopularityOverTime {
    if (tracks.length == 0) {
        return {
            scores: [],
            keys: []
        };
    }

    const sortedTracks = [...tracks].sort((a, b) => a.timestamp - b.timestamp);
    const allKeys = [...new Set(sortedTracks.map((track) => track.key))];

    let lastIdx = 0;
    let currentTime = sortedTracks[0].timestamp;
    const endTime = sortedTracks[sortedTracks.length - 1].timestamp;
    const scores: ScoresAtTime[] = [];
    while (currentTime <= endTime) {
        const chunkScores: ScoresAtTime = {
            scores: Object.fromEntries(allKeys.map((i) => [i, 0])),
            timestamp: sortedTracks[lastIdx].timestamp
        };

        for (const [idx, track] of sortedTracks
            .slice(lastIdx, undefined)
            .entries()) {
            if (
                track.timestamp >= currentTime &&
                track.timestamp <= currentTime + timeStepMs
            ) {
                chunkScores.scores[track.key] += track.score;
            } else {
                lastIdx += idx;
                scores.push(chunkScores);
                break;
            }
        }
        currentTime += timeStepMs;
    }
    return {
        scores: scores,
        keys: allKeys
    };
}

function color2hex(color: number[]): string {
    return (
        '#' +
        color
            .map((subpx) => {
                const base16 = Math.floor(subpx).toString(16);
                return base16.length == 1 ? '0' + base16 : base16;
            })
            .join('')
    );
}

function randColor(): string {
    return (
        '#' +
        (0x1000000 + Math.random() * 0xffffff).toString(16).substring(1, 7)
    );
}

function clamp(val: number, min: number, max: number): number {
    return Math.min(Math.max(val, min), max);
}

function lerp(a: number, b: number, t: number): number {
    return (1 - t) * a + t * b;
}

function unpackRgba(color: number): number[] {
    const r = (color >> 24) & 0xff;
    const g = (color >> 16) & 0xff;
    const b = (color >> 8) & 0xff;
    const a = color & 0xff;
    return [r, g, b, a];
}

export function drawGraph(allTracks: TrackData[], allExtTracks: TrackData[]) {
    // if both extended and regular track data are uploaded, use the one with more entries
    const rawData: RawDataPoint[] = (
        allExtTracks.length > allTracks.length ? allExtTracks : allTracks
    )
        .map((d) => ({
            key: d.artistName,
            score: d.msPlayed,
            timestamp: d.timestamp
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
    const popularity = popularityOverTime(
        rawData,
        2629800000 /* ~1 month, gives nice results */
    );

    // dataPoint formatted like https://github.com/d3/d3-shape#stack
    // interface {
    //     [key: string]: number;
    //     __timestamp: number;
    // }
    const data = popularity.scores.map((scores: ScoresAtTime) => {
        const dataPoint = scores.scores;
        dataPoint.__timestamp = scores.timestamp;
        return dataPoint;
    });
    const keys = popularity.keys;

    console.log(keys, data);

    // TODO: margin: https://bl.ocks.org/mbostock/3019563

    const canvas = d3
        .select('#d3')
        .append('canvas')
        .attr('id', 'canvas')
        .attr('width', WIDTH)
        .attr('height', HEIGHT);
    const canvasCtx = new WebglCtx('canvas');

    d3.select('#d3')
        .append('canvas')
        .style('display', 'none')
        .attr('id', 'offscreenCanvas')
        .attr('width', WIDTH)
        .attr('height', HEIGHT);
    const offscreenCtx = new WebglCtx('offscreenCanvas');

    const colorIdToKeyMap: Map<string, string> = new Map();
    const keyToColorIdMap: Map<string, string> = new Map();
    keys.forEach((key) => {
        let color: string = randColor();
        while (colorIdToKeyMap.has(color)) {
            color = randColor();
        }
        keyToColorIdMap.set(key, color);
        colorIdToKeyMap.set(color, key);
    });
    const stack = d3
        .stack()
        .offset(d3.stackOffsetWiggle)
        .order(d3.stackOrderInsideOut)
        .keys(keys);
    const stackedData = stack(data);
    const dataLookup = new Map();
    stackedData.forEach((datum) => {
        dataLookup.set(datum.key, datum);
    });

    const overlay = d3
        .select('#d3')
        .append('svg')
        .attr('id', 'overlay')
        .attr('width', WIDTH)
        .attr('height', HEIGHT);
    const selectionGroup = overlay.append('g').attr('id', 'selection');

    const x = d3
        .scaleTime()
        .domain(d3.extent(data, (d) => new Date(d.__timestamp)))
        .range([0, WIDTH]);
    const xAxis = d3.axisBottom(x);
    const y = d3
        .scaleLinear()
        .domain([
            d3.min(stackedData, (series) => d3.min(series, (d) => d[0])),
            d3.max(stackedData, (series) => d3.max(series, (d) => d[1]))
        ])
        .range([HEIGHT, 0]);

    // TODO: speed this up
    const firstListenedColor = (
        key: string,
        minAcceptedScore: number,
        colorNoiseAmt: number
    ) => {
        const lowestTs = rawData[0].timestamp;
        const highestTs = rawData[rawData.length - 1].timestamp;
        const firstListened = rawData.find(
            (datum) => datum.key == key && datum.score > minAcceptedScore
        );

        // if we don't find an entry with a score > minAcceptedScore, find the first occurrence of the key regardless of score
        const firstListenedTs = firstListened
            ? firstListened.timestamp
            : rawData.find((datum) => datum.key == key).timestamp;

        const normTs = (firstListenedTs - lowestTs) / (highestTs - lowestTs);
        const noise = (Math.random() - 0.5) * 2 * colorNoiseAmt;

        // return d3.interpolateRdYlGn(normTs);
        return d3.interpolateRainbow(normTs + noise);
        // return d3.interpolateTurbo(normTs);
        // return d3.interpolateCool(normTs);
    };
    const color = d3
        .scaleOrdinal()
        .domain(keys)
        .range(keys.map((k) => firstListenedColor(k, MINUTE, 0.04)));

    const area = d3
        .area()
        .x((d: any) => x(d.data.__timestamp))
        .y0((d) => y(d[0]))
        .y1((d) => y(d[1]))
        .curve(d3.curveBasis);
    const bottomLine = d3
        .line()
        .x((d: any) => x(d.data.__timestamp))
        .y((d) => y(d[0]))
        .curve(d3.curveBasis);
    const topLine = d3
        .line()
        .x((d: any) => x(d.data.__timestamp))
        .y((d) => y(d[1]))
        .curve(d3.curveBasis);

    // https://bocoup.com/blog/d3js-and-canvas
    const detachedContainer = document.createElement('custom');
    const dataContainer = d3.select(detachedContainer);
    const dataBinding = dataContainer
        .selectAll('custom.node')
        .data(stackedData)
        .enter()
        .append('custom')
        .classed('node', true)
        .attr('fill', (d) => String(color(d.key)));

    console.log('starting triangulate...');
    const t0 = performance.now();
    dataBinding.each(function (d: any) {
        const node = d3.select(this);
        const top: string = topLine.context(null)(d);
        const bot: string = bottomLine.context(null)(d);
        const color = node.attr('fill');
        const triangulated = new TriangulatedArea(top, bot);
        canvasCtx.add_area(triangulated, color);
        offscreenCtx.add_area(triangulated, keyToColorIdMap.get(d.key));
        triangulated.free();
    });
    const t1 = performance.now();
    console.log(`triangulate took ${t1 - t0} milliseconds.`);

    const mouseOverLine = overlay
        .append('rect')
        .attr('id', 'mouseOverLine')
        .attr('visibility', 'hidden')
        .attr('height', HEIGHT)
        .attr('width', OVERLAY_LINE_W)
        .attr('mask', 'url(#lineMask)');
    const lineMask = overlay.append('mask').attr('id', 'lineMask');

    const zoomRect = overlay
        .append('rect')
        .attr('id', 'zoomRect')
        .attr('visibility', 'hidden');

    const tooltip = overlay
        .append('text')
        .attr('id', 'tooltip')
        .attr('x', 50)
        .attr('y', 50)
        .attr('visibility', 'hidden');
    const tooltipArtist = tooltip.append('tspan').attr('x', 50).attr('dy', 0);
    const tooltipDate = tooltip
        .append('tspan')
        .attr('x', 50)
        .attr('dy', '1.2em');

    const gX = overlay.append('g').attr('id', 'xAxis').call(xAxis);

    const zoom = d3
        .zoom()
        .filter(() => false) // no auto zoom / pan
        .scaleExtent([1, 10])
        .translateExtent([
            [0, 0],
            [WIDTH, HEIGHT]
        ])
        .on('zoom', ({ transform }) => {
            gX.call(xAxis.scale(transform.rescaleX(x)));

            canvasCtx.set_transform(transform.x, transform.y, transform.k);
            canvasCtx.draw();

            d3.selectAll('.selectedArea')
                .attr('transform', transform)
                .attr('stroke-width', SELECTION_STROKE_W / transform.k);
            mouseOverLine.attr('width', OVERLAY_LINE_W * transform.k);
        })
        .on('end', ({ transform }) => {
            if (transform.k > 2) {
                gX.call(xAxis.ticks(d3.timeMonth.every(1)));
            }
            //  else {
            //     gX.call(xAxis.ticks(d3.timeMonth.every(2)));
            // }

            offscreenCtx.set_transform(transform.x, transform.y, transform.k);
            offscreenCtx.draw();
        });

    let selectedKey: string | null = null;
    let [zoomRectInitX, zoomRectInitY] = [0, 0];
    overlay
        .on('mousedown', (ev) => {
            [zoomRectInitX, zoomRectInitY] = d3.pointer(ev, overlay.node());
            zoomRect
                .attr('visibility', 'visible')
                .attr('x', zoomRectInitX)
                .attr('y', zoomRectInitY)
                .attr('width', 0)
                .attr('height', 0);
        })
        .on('mousemove', (ev) => {
            if (selectedKey != null) {
                const curTransform = d3.zoomTransform(canvas.node() as Element);
                const mouseX = d3.pointer(ev, overlay.node())[0];
                const zoomedX = curTransform.invertX(mouseX);
                const fltIdx = (zoomedX / WIDTH) * (data.length - 1);
                if (fltIdx >= 0 && fltIdx <= data.length - 1) {
                    const lerpAmt = fltIdx - Math.floor(fltIdx);

                    const minsListened = Math.round(
                        lerp(
                            data[Math.floor(fltIdx)][selectedKey],
                            data[Math.ceil(fltIdx)][selectedKey],
                            lerpAmt
                        ) / MINUTE
                    );

                    const lerpDate = new Date(
                        lerp(
                            data[Math.floor(fltIdx)].__timestamp,
                            data[Math.ceil(fltIdx)].__timestamp,
                            lerpAmt
                        )
                    );

                    tooltipArtist.text(
                        `${selectedKey} : ${(minsListened / 60).toFixed(
                            2
                        )} hours listened`
                    );
                    tooltipDate.text(
                        `Around ${lerpDate.toLocaleString('default', {
                            month: 'long',
                            year: 'numeric'
                        })}`
                    );
                }
                mouseOverLine.attr(
                    'x',
                    mouseX - +mouseOverLine.attr('width') / 2
                );
            }
            if (ev.buttons > 0) {
                const [mouseX, mouseY] = d3.pointer(ev, overlay.node());
                zoomRect
                    .attr('x', Math.min(zoomRectInitX, mouseX))
                    .attr('y', Math.min(zoomRectInitY, mouseY))
                    .attr('width', Math.abs(zoomRectInitX - mouseX))
                    .attr('height', Math.abs(zoomRectInitY - mouseY));
            }
        })
        .on('mouseup', (ev) => {
            zoomRect.attr('visibility', 'hidden');
            const [mouseX, mouseY] = d3.pointer(ev, overlay.node());
            const curTransform = d3.zoomTransform(canvas.node() as Element);
            const [zoomX, zoomY, zoomWidth, zoomHeight] = [
                +zoomRect.attr('x'),
                +zoomRect.attr('y'),
                +zoomRect.attr('width'),
                +zoomRect.attr('height')
            ];

            // on a click
            if (zoomWidth == 0 || zoomHeight == 0) {
                canvas.style('opacity', 1);
                tooltip.attr('visibility', 'hidden');
                mouseOverLine.attr('visibility', 'hidden');
                d3.selectAll('.selectedArea').remove();

                const lookupColor = color2hex(
                    unpackRgba(
                        offscreenCtx.get_pixel(
                            Math.round(mouseX),
                            Math.round(mouseY)
                        )
                    ).slice(0, 3)
                );

                const keyFromColor = colorIdToKeyMap.get(lookupColor);
                if (keyFromColor == selectedKey || keyFromColor == undefined) {
                    selectedKey = null;
                } else {
                    selectedKey = keyFromColor;
                    canvas.style('opacity', 0.5);
                    tooltip.attr('visibility', 'visible');
                    tooltipArtist.text(selectedKey);
                    mouseOverLine.attr('visibility', 'visible');
                    mouseOverLine.attr(
                        'x',
                        mouseX - +mouseOverLine.attr('width') / 2
                    );
                    const datum = dataLookup.get(selectedKey);
                    selectionGroup
                        .append('path')
                        .data([datum])
                        .classed('selectedArea', true)
                        .style('fill', (d) => String(color(d.key)))
                        .attr('d', area.context(null))
                        .attr(
                            'stroke-width',
                            SELECTION_STROKE_W / curTransform.k
                        )
                        .attr('transform', <any>curTransform);
                    lineMask
                        .append('path')
                        .data([datum])
                        .classed('selectedArea', true)
                        .attr('fill', 'white')
                        .attr('stroke', 'black')
                        .attr('d', area.context(null))
                        .attr(
                            'stroke-width',
                            SELECTION_STROKE_W / curTransform.k
                        )
                        .attr('transform', <any>curTransform);
                }
                return;
            }

            // if we're already zoomed in, reset zoom
            if (
                curTransform.x != 0 ||
                curTransform.y != 0 ||
                curTransform.k != 1
            ) {
                canvas
                    .transition()
                    .duration(TRANSITION_DUR)
                    .call(<any>zoom.transform, d3.zoomIdentity)
                    .on('start', () => {
                        gX.call(xAxis.ticks(d3.timeMonth.every(2)));
                    });
            }
            // else, perform zoom
            else {
                const scale =
                    1 / Math.max(zoomWidth / WIDTH, zoomHeight / HEIGHT);
                const [svgCenterX, svgCenterY] = [WIDTH / 2, HEIGHT / 2];
                const [zoomCenterX, zoomCenterY] = [
                    zoomX + zoomWidth / 2,
                    zoomY + zoomHeight / 2
                ];
                const [relX, relY] = [
                    svgCenterX - zoomCenterX,
                    svgCenterY - zoomCenterY
                ];
                const transform = d3.zoomIdentity
                    //https://stackoverflow.com/questions/43184515/d3-js-v4-zoom-to-chart-center-not-mouse-position
                    .translate(
                        svgCenterX - (2 * svgCenterX * scale) / 2,
                        svgCenterY - (2 * svgCenterY * scale) / 2
                    )
                    .scale(scale)
                    .translate(relX, relY);
                canvas
                    .transition()
                    .duration(TRANSITION_DUR)
                    .call(<any>zoom.transform, transform)
                    .on('end', () => {
                        //TODO: force redraw of overlay (in firefox only?)
                    });
            }
        })
        .on('mouseout', () => tooltipArtist.text(selectedKey));

    // draws initial graph, redrawn on every zoom event
    canvas.call(<any>zoom.transform, d3.zoomIdentity);
}
