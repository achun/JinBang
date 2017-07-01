let base = require('../data/base.json'),
	schools = require('../data/schools.json'),
	totals = require('../data/total.json'),
	fen = require('../data/total.json'),
	rank = require('../data/rank.json');

exports.search = search
exports.base = base
exports.schools = schools
exports.totals = totals
exports.rank = rank

function search(
	a,       // 数组 已排序
	callback /**
	 * 回调函数 function (element) :integer
	 * element 为输入数组的一个元素
	 * 返回值:
	 *     0 停止搜索, 返回 element 的下标
	**/
) {
	// 二分法搜索已经排序的数组
	// 返回值 整型, a 的一个下标, 范围 [0 : a.length)
	// 如果 a.length == 0 直接返回 0
	let i = 0,
		j = a.length;
	if (!j) return 0
	while (true) {
		let h = i + ((j - i) >> 1),
			k = callback(a[h]);
		if (!k || i >= j) return h
		if (k < 0) {
			j = h - 1
		} else {
			i = h + 1
		}
	}
}

exports.school = function school(
	codes,    // 数组, 元素为四位院校代码
	callback // 回调函数 function(code, object), 如果院校不存在 object 为 null
) {
	// 遍历 codes 在 schools 中查找院校, 并引用回调函数
	// 如果院校不存在,
	codes.forEach(function(s) {
		callback(s, s.length == 4 && schools[s] || null)
	})
}

exports.hope = function hope(
	kl,       // 科类代码
	actual    // 总分
) {
	// 在 rank 中按科类(kl) 查找并返回总分(actual) 上下 10 档(分) 的数组
	// 如果 kl 不存在返回 null
	let h = actual,
		a = rank[kl];

	if (!a) null

	h = search(a, function(a) {
		return a[0] > h && 1 || a[0] < h && -1 || 0
	})

	let i = h && h - 10 || h,
		j = h && h + 10 || h;
	if (i < 0)
		i = 0;
	if (j > a.length)
		j = a.length;

	return a.slice(i, j)
}