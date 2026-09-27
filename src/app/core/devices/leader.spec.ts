import { insertElbow, leaderPath, nearestPointOnBox, pathData, pointToSegment, removeLeaderPoint, withAnchor } from './leader';

const box = { x: 100, y: 100, w: 200, h: 40 };

describe('leader lines', () => {
  it('starts on the box edge nearest the first point', () => {
    expect(nearestPointOnBox(box, { x: 500, y: 120 })).toEqual({ x: 300, y: 120 });
    expect(nearestPointOnBox(box, { x: 0, y: 0 })).toEqual({ x: 100, y: 100 });
    expect(nearestPointOnBox(box, { x: 150, y: 400 })).toEqual({ x: 150, y: 140 });
    // Inside: the closest edge.
    expect(nearestPointOnBox(box, { x: 290, y: 120 })).toEqual({ x: 300, y: 120 });
    expect(nearestPointOnBox(box, { x: 150, y: 105 })).toEqual({ x: 150, y: 100 });
  });

  it('builds the path through elbows to the anchor', () => {
    expect(leaderPath(box, undefined)).toEqual([]);
    expect(leaderPath(box, [{ x: 400, y: 200 }, { x: 500, y: 200 }])).toEqual([
      { x: 300, y: 140 },
      { x: 400, y: 200 },
      { x: 500, y: 200 },
    ]);
    expect(pathData([{ x: 1.26, y: 2 }, { x: 3, y: 4 }])).toBe('M1.3 2L3 4');
  });

  it('measures the distance to a segment', () => {
    expect(pointToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ distance: 5, point: { x: 5, y: 0 } });
    expect(pointToSegment({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }).distance).toBe(5);
    expect(pointToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 }).distance).toBe(5);
  });

  it('inserts an elbow on the clicked segment', () => {
    const leader = [{ x: 400, y: 120 }, { x: 400, y: 300 }];
    const path = leaderPath(box, leader); // (300,120) -> (400,120) -> (400,300)
    expect(insertElbow(path, leader, { x: 350, y: 121 })).toEqual({ leader: [{ x: 350, y: 121 }, ...leader], index: 0 });
    expect(insertElbow(path, leader, { x: 401, y: 200 })).toEqual({ leader: [leader[0], { x: 401, y: 200 }, leader[1]], index: 1 });
  });

  it('moves the anchor and removes points', () => {
    expect(withAnchor(undefined, { x: 1, y: 2 })).toEqual([{ x: 1, y: 2 }]);
    expect(withAnchor([{ x: 5, y: 5 }, { x: 9, y: 9 }], { x: 1, y: 2 })).toEqual([{ x: 5, y: 5 }, { x: 1, y: 2 }]);
    const l = [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
    expect(removeLeaderPoint(l, 1)).toEqual([{ x: 1, y: 1 }, { x: 3, y: 3 }]);
    expect(removeLeaderPoint(l, 2)).toBeUndefined();
  });
});
