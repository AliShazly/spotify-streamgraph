use crate::{Line, Point, Triangle};
use svgtypes::{PathParser, PathSegment, PathSegment::*};

#[derive(Debug, Clone, Copy)]
enum Primitive {
    Point(Point),
    Line(Line),
}

impl Point {
    fn lerp(&self, other: Self, t: f64) -> Self {
        Self::new(lerp(self.x, other.x, t), lerp(self.y, other.y, t))
    }
    fn berp(&self, other: Self, c1: Self, c2: Self, t: f64) -> Self {
        Self::new(
            berp(self.x, c1.x, c2.x, other.x, t),
            berp(self.y, c1.y, c2.y, other.y, t),
        )
    }
    fn distance(&self, other: Self) -> f64 {
        let a = self.x - other.x;
        let b = self.y - other.y;
        ((a * a) + (b * b)).sqrt()
    }
    fn average(&self, other: Self) -> Self {
        Self::new((self.x + other.x) / 2., (self.y + other.y) / 2.)
    }
}

impl Primitive {
    fn as_point(&self) -> Point {
        match *self {
            Self::Point(p) => p,
            _ => panic!("{:?} is not a point", self),
        }
    }
    fn as_line(&self) -> Line {
        match *self {
            Self::Line(l) => l,
            _ => panic!("{:?} is not a line", self),
        }
    }
}

// part of the d3-area with a measurable area
// area is represented by an array of adjacent lines from top of each sample to bottom,
//   and the points before/after to the first/last line in the sequence
// ----start·<|||middle|||>·end-----
#[derive(Debug, Default)]
struct Area {
    start: Option<Point>,
    middle: Vec<Line>,
    end: Option<Point>,
}

// part of the d3-area with no measurable area,
// an array of line segments that form a longer line
// ---Chain---<||||Area||||>----
type Chain = Vec<Line>;

pub fn gen_mesh(top_line: &str, bot_line: &str) -> Result<(Vec<Triangle>, Vec<Line>), String> {
    // svg path should start at zero and move in the positive x direction
    let top_segments = PathParser::from(top_line)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Path Parsing Error: {:?}", e))?;
    let bot_segments = PathParser::from(bot_line)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Path Parsing Error: {:?}", e))?;

    let top_points = points_along_path(&top_segments, 10)?;
    let bot_points = points_along_path(&bot_segments, 10)?;

    assert!(top_points.len() == bot_points.len());

    let lines_and_points = pair_points(
        top_points.into_iter().zip(bot_points.into_iter()),
        f32::EPSILON as f64, // webgl represents points as f32
    );
    let lines: Vec<Line> = find_chains(&lines_and_points)
        .into_iter()
        .flatten()
        .collect();
    let triangles: Vec<Triangle> = find_areas(&lines_and_points)
        .into_iter()
        .flat_map(triangulate_area)
        .collect();

    Ok((triangles, lines))
}

fn triangulate_area(area: Area) -> Vec<Triangle> {
    assert!(!area.middle.is_empty());

    let first_tri: Option<Triangle> = area.start.map(|p| {
        let first_line: &Line = area.middle.first().unwrap();
        [p, first_line[1], first_line[0]]
    });
    let last_tri: Option<Triangle> = area.end.map(|p| {
        let last_line: &Line = area.middle.last().unwrap();
        [p, last_line[0], last_line[1]]
    });
    let middle_tris = area
        .middle
        .windows(2)
        .flat_map(|slice| make_quad(slice[0], slice[1]));
    first_tri
        .into_iter()
        .chain(middle_tris.chain(last_tri.into_iter()))
        .collect()
}

// assuming that l1 is left of l2 and each line goes from top to bottom
/*
    p1    p3          ┌──────┐
    │      │          │ ╲    │tri2
  l1│    l2│    ->    │  ╲   │      tri1: p1 -> p2 -> p4
    │      │          │   ╲  │      tri2: p4 -> p3 -> p1
    │      │      tri1│    ╲ │
    p2    p4          └──────┘
*/
fn make_quad(l1: Line, l2: Line) -> [Triangle; 2] {
    [
        /* tri1: */ [l1[0], l1[1], l2[1]],
        /* tri2: */ [l2[1], l2[0], l1[0]],
    ]
}

// area => ..[?point][any number of lines][?point]..
fn find_areas(primitives: &[Primitive]) -> Vec<Area> {
    primitives
        .iter()
        .enumerate()
        .collect::<Vec<_>>()
        .split(|(_, &p)| matches!(p, Primitive::Point(_)))
        .filter_map(|slice| {
            if !slice.is_empty() {
                let first_line_idx = slice.first().unwrap().0;
                let start = if first_line_idx != 0 {
                    primitives.get(first_line_idx - 1).map(|p| p.as_point())
                } else {
                    None
                };
                let end = primitives
                    .get(slice.last().unwrap().0 + 1)
                    .map(|p| p.as_point());
                let middle: Vec<Line> = slice.iter().map(|(_, &p)| p.as_line()).collect();

                Some(Area { start, middle, end })
            } else {
                None
            }
        })
        .collect()
}

// chain => ..[any number of points]..
fn find_chains(primitives: &[Primitive]) -> Vec<Chain> {
    primitives
        .split(|&p| matches!(p, Primitive::Line(_)))
        .filter_map(|point_slice| {
            if point_slice.len() > 1 {
                Some(
                    point_slice
                        .windows(2)
                        .map(|adj_pts| [adj_pts[0].as_point(), adj_pts[1].as_point()])
                        .collect::<Chain>(),
                )
            } else {
                None
            }
        })
        .collect()
}

fn pair_points(pairs: impl Iterator<Item = (Point, Point)>, dist_thresh: f64) -> Vec<Primitive> {
    pairs
        .map(|(top_pt, bottom_pt)| {
            if top_pt.distance(bottom_pt) > dist_thresh {
                Primitive::Line([top_pt, bottom_pt])
            } else {
                Primitive::Point(top_pt.average(bottom_pt))
            }
        })
        .collect()
}

fn points_along_path(
    path: &[PathSegment],
    samples_per_segment: i32,
) -> Result<Vec<Point>, &'static str> {
    assert!(samples_per_segment > 0);

    let init_pt = match path.first() {
        Some(&path) => match path {
            MoveTo { x, y, .. } => Point::new(x, y),
            _ => return Err("Path must begin with MoveTo"),
        },
        None => return Ok(Vec::new()),
    };

    let mut out_pts: Vec<Point> = Vec::new();
    let mut current_pt = init_pt;
    for &seg in path.iter().skip(1) {
        let mut inter_pts = interpolate_segment(current_pt, seg, samples_per_segment)?;
        current_pt = inter_pts.pop().unwrap();
        out_pts.extend(inter_pts);
    }

    Ok(out_pts)
}

//TODO: make absolute/relative agnostic
fn interpolate_segment(
    cur_pt: Point,
    segment: PathSegment,
    mut n_samples: i32,
) -> Result<Vec<Point>, &'static str> {
    let (dst_pt, control_pts) = match segment {
        CurveTo { x, y, x1, y1, x2, y2, .. } => {
            let dst_pt = Point::new(x, y);
            let control1 = Point::new(x1, y1);
            let control2 = Point::new(x2, y2);
            (dst_pt, Some((control1, control2)))
        }
        LineTo { x, y, .. } => (Point::new(x, y), None),
        HorizontalLineTo { x, .. } => (Point::new(x, cur_pt.y), None),
        VerticalLineTo { y, .. } => (Point::new(cur_pt.x, y), None),
        MoveTo { .. } => return Err("Subpaths not supported"),
        _ => unimplemented!(),
    };

    // less samples needed for linear interpolation
    if control_pts.is_none() {
        n_samples /= 2
    }

    let step_size = 1. / n_samples as f64;
    Ok((0..n_samples)
        .map(|i| {
            let t = i as f64 * step_size;
            if let Some((c1, c2)) = control_pts {
                cur_pt.berp(dst_pt, c1, c2, t)
            } else {
                cur_pt.lerp(dst_pt, t)
            }
        })
        // apending dst_pt to make sure both t=0 and t=1 are returned
        .chain([dst_pt].into_iter())
        .collect())
}

// cubic bezier interpolation
fn berp(a: f64, b: f64, c: f64, d: f64, t: f64) -> f64 {
    let t2: f64 = t * t;
    let t3: f64 = t2 * t;
    a + (-a * 3. + t * (3. * a - a * t)) * t
        + (3. * b + t * (-6. * b + b * 3. * t)) * t
        + (c * 3. - c * 3. * t) * t2
        + d * t3
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    (1. - t) * a + t * b
}
