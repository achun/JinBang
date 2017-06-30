
const fs = require('fs'),
	iconv = require('iconv-lite'),
	charset = require('charset'),
	http = require('http'),
	JSDOM = require('jsdom').JSDOM,
	Buffer = require('buffer').Buffer,
	querystring = require('querystring');

let base = require('./data/base.json'),
	schools = require('./data/schools.json'),
	history = require('./data/history.json'),
	plans = require('./data/plans.json');

/**
provinces

11 12 13 14 15
21 22 23
31 32 33 34 35 36 37
41 42 43 44 45 46
50 51 52 53 54
61 62 63 64 65 81
**/
const domain = 'www.heao.gov.cn',
	paths = {
		default: 'http://www.heao.gov.cn/JHCX/PZ/enrollplan/default.aspx',
		SchoolList: '/JHCX/PZ/enrollplan/SchoolList.aspx', // POST
		PCList: 'http://www.heao.gov.cn/JHCX/PZ/enrollplan/PCList.aspx',
		// 历史数据查询配置, 替换三个变量 $year, $kl, $pc
		'2016': {
			url: 'http://www.heao.gov.cn/datacenter/pages/PZTJFSD.aspx?ddlNF=$year&ddlKL=$kl&ddlPC=$pc',
			KL: { '文科': '1', '理科': '5' },
			PC: {// 该次序应该按照分值高低排列
				'本科第一批': '1',
				'本科第二批': '2',
				'本科第三批': '2',
				'高职高专批': '4'
			}
		}
	};

const cmds = {
	help: function() {
		echo(fs.readFileSync(__dirname + '/usage.txt', 'utf8'))
		process.exit(0)
	},
	valid: function() {
		let ok = true;
		'base schools history plans fen'.split(' ')
			.forEach(function(s) {
				let text = fs.readFileSync('./data/' + s + '.json', 'utf8');
				if (text.indexOf('�') != -1) {
					ok = false
					echo('invalid � : ' + s)
				}
			})
		ok && echo('pass')
	},
	base: function() {
		let codes,
			year = Date.prototype.getFullYear.call(new Date());

		base = { year: year }
		get(paths.default, function(doc) {
			fetchBase(doc, base)
			codes = Object.keys(base.provinces);
			if (codes && codes.length) {
				base.schools = { }
				list()
			} else error('未获取省市列表')
		})

		// 按照省市抓取院校列表
		function list() {
			let dist,
				province = codes.shift();
			if (!province) {
				writeFile('./data/base.json', base)
				return
			}
			dist = base.schools[province] = [];

			fetchFirstPageDoc(province, function(doc) {
				walkSchoolsList(doc, function(doc) {
					doc.querySelectorAll('li.SchoolList a').forEach(
						function(elm) {
							let code = elm.href.split('=').pop()
							if (dist.indexOf(code) != -1)
								error('重复的院校代号 ' + province + ':' + code)
							else dist.push(code)
						})
				}, list)
			})
		}
	},
	plans: function(
		...codes // 4 位院校代号, 缺省为全部院校
	) {

		let hrefs = [];

		if (!arguments.length) {
			plans = { }
			fetchFirstPageDoc(-1, function(doc) {
				walkSchoolsList(doc, function(doc) {
					doc.querySelectorAll('li.SchoolList a').forEach(
						function(elm) {
							hrefs.push(elm.href)
						})
				}, step)
			})

		} else {
			hrefs = toArray(arguments).map(function(code) {
				if (code.length != 4) error('院校代号必须为四位')
				paths.PCList + '?YXDH=' + code
			})
			step()
		}

		function step() {
			if (!hrefs.length) {
				writeFile('./data/schools.json', schools)
				writeFile('./data/plans.json', plans)
				echo('done')
				return
			}

			get(hrefs.shift(), function(doc) {
				fetchPlans(doc, step)
			})
		}
	},
	count: function() {
		// 输出统计信息,
		let total = 0,
			problem = [],
			codes = base.schools && Object.keys(base.schools).sort(),
			KeysP = Object.keys(base.provinces).sort(),
			KeysPC = Object.keys(base.PC),
			KeysKL = Object.keys(base.KL),
			KeysSchools = Object.keys(schools).sort(),
			KeysPlans = Object.keys(plans).sort();

		codes && codes.forEach(function(code, i) {
			total += base.schools[code].length
		})
		echo('年份\t' + base.year)
		echo('省市\t' + KeysP.length)
		echo('\t' + KeysP.join(' '))

		echo('批次\t' + KeysPC.length)
		echo('科类\t' + KeysKL.length)

		echo('院校\t' + KeysPlans.length + ', 省市 ' + total)

		echo('更名\t' + Object.keys(history.renamed).length)
		echo('无计划\t' + Object.keys(history.planless).length)

		if (!codes)
			problem.push('base.schools 缺失, 需要更新 plans')
		else {

			if (KeysP.join(' ') != codes.join(' ')) {
				problem.push('base.schools 未囊括的省市代号')
				problem.push(codes.join(' '))
			}

			if (KeysPlans.length != KeysSchools.length)
				problem.push('schools 院校数为 ' + KeysSchools.length)
		}
		total = 0
		let pcs = [],
			kls = [],
			xys = [];
		KeysPlans = [] // 复用, 表示未囊括的院校
		someEach(history, function(o, pc) {
			if (!parseInt(pc)) return
			if (!base.PC[pc]) {
				pcs.push(pc)
				return
			}
			someEach(o, function(a, kl) {
				if (!base.KL[kl]) {
					kls.indexOf(kl) == -1 && kls.push(kl)
					return
				}
				a.forEach(function(a) {
					a.forEach(function(code, i) {
						if (!i) return
						if (!plans[code]) {
							xys.indexOf(code) == -1 && xys.push(code)
							return
						}

						(!plans[code][pc] || !plans[code][pc][kl]) &&
						KeysPlans.indexOf(code) == -1 &&
						KeysPlans.push(code)

						return
					})
				})
			})
		})

		if (KeysPlans.length) {
			echo('历史数据未囊括的院校 ' + KeysPlans.length)
			while (true) {
				console.log(KeysPlans.slice(0, 16).join(' '))
				KeysPlans = KeysPlans.slice(16)
				if (!KeysPlans.length) break
			}
		}

		if (pcs.length)
			problem.push('历史数据中有未知批次 ' + pcs.join(' '))
		if (kls.length)
			problem.push('历史数据中有未知科类 ' + kls.join(' '))
		if (xys.length)
			problem.push('历史数据中有未知院校 ' + xys.join(' '))

		if (problem.length) {
			echo('问题:')
			problem.forEach(function(s) {
				echo('\t' + s)
			})
			process.exit(1)
		}

	},
	history: function() {
		// 抓取上年平行投档分数线, 合并到 plans.json
		let year = Date.prototype.getFullYear.call(new Date()) - 1,
			cfg = paths[year] || paths['2016'],
			tasks = [];

		history = { }
		someEach(cfg.PC, function(pcCode, pc) {
			let url = cfg.url.replace('$year', year)
				.replace('$pc', bufToQuery(iconv.encode(pc, 'gbk')))

			history[pcCode] = { }
			someEach(cfg.KL, function(klCode, kl) {
				history[pcCode][klCode] = []
				tasks.push(
					[
						pcCode, klCode,
						url.replace('$kl', bufToQuery(iconv.encode(kl, 'gbk')))
					]
				)
			})
		})
		history.planless = { }
		history.renamed = { }

		step()
		function step() {
			let task = tasks.shift(),
				PC = task && task[0],
				KL = task && task[1],
				dist = task && history[PC][KL],
				ignore = task && PC != '1' && PC != '2',
				// 非本科批次变动较大, 不计算 planless
				total;
			if (!task) {
				writeFile('./data/plans.json', plans)
				writeFile('./data/history.json', history)

				total = Object.keys(history.renamed).length
				if (total) echo('更名 ' + total)

				total = Object.keys(history.planless).length
				if (total) echo('无计划  ' + total)

				echo('done')
				return
			}

			get(task[2], function(doc) {
				let want = '院校代号,院校名称,计划,实际投档人数,投档最低分',
					row,
					keys = [];
				doc.querySelectorAll('tr').forEach(
					function(tr) {
						if (!keys.length) {
							tr.querySelectorAll('td').forEach(function(td, i) {
								let text = td.textContent.replace(/\s/g, '');
								keys.push(text)
							})

							if (keys.slice(0, 5).join(',') != want)
								keys = []
							return
						}
						row = []
						tr.querySelectorAll('td').forEach(function(td, i) {
							if (i > 4) return
							let text = td.textContent.trim()
							row.push(
								i == 0 && text ||
								i == 1 && normal(text) ||
								parseInt(text) || 0
							)
						})

						if (!row.length || !row[0]) return

						if (plans[row[0]] &&
							plans[row[0]][PC] && plans[row[0]][PC][KL]) {
							plans[row[0]][PC][KL].history = row[4]
						} else {
							if (!ignore)
								history.planless[row[0]] = row[1]
							return
						}

						if (schools[row[0]]['院校名称'] != row[1]) {
							history.Renamed[row[0]] = {
								old: row[1],
								now: schools[row[0]]['院校名称']
							}
						}

						// 投档最低分, 院校代号...
						dist.every(function(a) {
							if (a[0] == row[4]) {
								a.push(row[0])
								return false
							}
							return true
						}) && dist.push([row[4], row[0]])
					}
				)

				if (!keys.length)
					error('Need to update history')

				dist.sort(function(a, b) {
					return a[0] < b[0] && 1 || -1
				})

				step()
			})
		}
	},
	name: function() {
		// 根据四位院校代码输出院校名称
		toArray(arguments).forEach(function(s) {
			if (s.length == 4 && schools[s]) {
				echo('[' + s + ']' + schools[s]['院校名称'])
			}
		})
	},
	rank: rank, // 按科类生成志愿填报排行
	hope: function(
		kl,    // 科类代码
		actual // 总分
	) {
		// 输出科类(kl) 和总分(fen) 在 rank.json 中上下 10 档(分)的院校
		let h = actual,
			rank = require('./data/rank.json')[kl];
		if (!rank) error('未定义科类代号 ' + kl)

		h = search(rank, function(a) {
			return a[0] > h && 1 || a[0] < h && -1 || 0
		})

		let i = h && h - 10 || h,
			j = h && h + 10 || h;
		if (i < 0)
			i = 0;
		if (j > rank.length)
			j = rank.length;

		rank.slice(i, j).forEach(function(a) {
			echo(a[0] + '\t' + a[1])
			a.forEach(function(code, i) {
				if (i < 2) return
				echo('\t' + paths.PCList + '?YXDH=' + code + ' ' +
					(schools[code] && schools[code]['院校名称'] || ''))
			})
		})
	}
}

main()

function main() {

	let args = process.argv.slice(2),
		cmd = cmds[args.shift() || 'help'] || cmds.help;
	cmd.apply(null, args)
}

function someEach(obj, callback) {
	let some;
	for (let k in obj) {
		some = callback(obj[k], k)
		if (some != null) break
	}
	return some
}

function rank() {
	// 按科类生成志愿填报排行
	let fen = require('./data/fen.json');
	Object.keys(fen).forEach(function(kl) {
		let top = fen[kl],
			min = top[top.length - 1][0];

		// 从所有历史批次中选出分值范围内的院校
		someEach(history, function(o, pc) {
			if (!parseInt(pc)) return
			someEach(o, function(a, k) {
				if (k != kl) return
				a.some(function(a, i) {
					i = a[0]
					if (i < min) return true
					// 先按分数段挑出院校
					// 因为去年的批次不一定和今年一样
					i = search(top, function(a) {
						return a[0] > i && 1 || a[0] < i && -1 || 0
					})

					a.forEach(function(code, i) {
						if (i && this.indexOf(code, 2) == -1)
							this.push(code)
					}, top[i])
				})
			})
		})
		fen[kl] = top.filter(function(a) {
			return a.length > 2
		})
	})
	writeFile('./data/rank.json', fen)
}

function search(a, dir) {
	// 二分法搜索数组
	let i = 0,
		j = a.length;
	if (!j) return -1
	while (true) {
		let h = i + ((j - i) >> 1),
			k = dir(a[h]);
		if (!k || i >= j) return h
		if (k == -1) {
			j = h - 1
		} else {
			i = h + 1
		}
	}
}

function bufToQuery(buf) {
	let s = ''
	for (const v of buf.values()) {
		s += '%' + v.toString(16)
	}
	return s
}

function get(url, onend) {
	let retry = 3;
	echo('GET ' + url)
	run()
	function run() {
		http.get(url, function(res) {
			var chunks = [];
			if (res.statusCode != 200) {
				error(res.statusMessage || res.statusCode);
			}

			res.on('data', function(chunk) {
				chunks.push(chunk);
			});

			res.on('end', function() {
				let body,
					ct = charset(res.headers['content-type']);

				if (ct != 'utf8')
					body = iconv.decode(Buffer.concat(chunks), ct);
				else
					body = Buffer.concat(chunks).toString();
				if (body.indexOf('�') == -1)
					onend((new JSDOM(body, { url: url })).window.document)
				else {
					retry--
					if (!retry)
						error(`invalid encoding GET ${url}: ${e.message}`);
					echo('retry')
					setTimeout(run, 500)
				}
			});

		}).on('error', function(e) {
			retry--
			if (!retry)
				error(`problem GET ${url}: ${e.message}`);
			echo('retry')
			setTimeout(run, 2000)
		});
	}
}

function post(path, obj, onend) {
	let url = 'http://' + domain + path,
		retry = 3,
		postData = querystring.stringify(obj),
		opt = {
			hostname: domain,
			port: 80,
			path: path,
			method: 'POST',
			headers: {
				'Referer': 'http://' + domain + path,
				'Content-Type': 'application/x-www-form-urlencoded',
				'Content-Length': Buffer.byteLength(postData)
			}
		};

	echo('POST ' + url + ' : ' + postData)
	run()
	function run() {
		let req = http.request(opt, function ready(res) {
			var chunks = [];
			res.on('data', function(chunk) {
				chunks.push(chunk);
			});

			res.on('end', function() {
				let body,
					ct = charset(res.headers['content-type']);

				if (ct != 'utf8')
					body = iconv.decode(Buffer.concat(chunks), ct);
				else
					body = Buffer.concat(chunks).toString();
				if (body.indexOf('�') == -1)
					onend((new JSDOM(body, { url: url })).window.document)
				else {
					retry--
					if (!retry)
						error(`invalid encoding GET ${url}: ${e.message}`);
					echo('retry')
					setTimeout(run, 500)
				}
			});
		});

		req.on('error', function(e) {
			retry--
			if (!retry)
				error(`problem POST ${url}: ${e.message}`);
			echo('retry')
			setTimeout(run, 2000)
		});

		req.write(postData);
		req.end();
	}
}

function normal(name) {
	// 规范化院校名称
	return name.replace(' ', '')
		.replace(/（/g, '(')
		.replace(/）/g, ')')
}

function fetchPlans(doc, done) {
	// 抓取院校基本信息和录取计划
	let elm = must(doc, 'td.yxdhtd'),
		code = elm.textContent.trim(),
		dist = schools[code] = schools[code] || { },
		url = doc.location.href;

	dist['院校代号'] = code;
	dist['院校名称'] = normal(must(doc, 'td.yxmctd').textContent.trim());
	doc.querySelectorAll('td.tdright').forEach(function(left) {
		let name = left.textContent.trim().replace(/：|　| /g, ''),
			right = left.nextElementSibling;

		if (!right.classList.contains('tdleft')) return
		left = right.querySelector('a')
		this[name] = left && left.href || right.textContent.trim()
	}, dist)

	dist = plans[code] = plans[code] || { }

	let hrefs = [];

	doc.querySelectorAll('td.tdpc').forEach(function(left) {
		let pccode,
			right = mustNextElementSibling(left, 'tdjhrs', url),
			total = parseInt(right.textContent) || 0;
			// 有计划为 0 的情况

		right = left.querySelector('a')
		pccode = right && right.href.split('=').pop()

		if (!pccode)
			error('undefined PC code of plan')

		this[pccode] = { total: total }
		hrefs.push(right.href)
	}, dist)

	run()

	function run() {
		let href = hrefs.shift()
		if (!href)
			done()
		else get(href, function(doc) {
				fetchPCContend(doc, dist)
				run()
			})
	}
}

function fetchPCContend(doc, dist) {
	// 该页面是同一个批次的
	let pc,
		sum = 0,
		url = doc.location.href;
	doc.querySelectorAll('td.planListTD:nth-child(1)').forEach(function(elm) {
		let a = must(elm, 'a'),
			cat = mustNextElementSibling(elm, 'tdpcjhrs', url),
			total = mustNextElementSibling(cat, 'tdpcjhrs', url),
			note = mustNextElementSibling(total, 'planListTD', url),
			key ,
			dist,
			args = { };
		a.href.split(/[?=&]/).forEach(function(s, i) {
			if (!i) return
			if (!key) {
				key = s
			} else {
				args[key] = s
				key = ''
			}
		}, args)

		dist = this[args.PC]// PC->KL->ZY->{}
		if (!dist || !args.PC || !args.ZY || !args.KL ||
			!base.PC[args.PC] || !base.KL[args.KL] ||
			pc && pc != args.PC)
			error('invalid arguments of plan ' + JSON.stringify(args))

		pc = args.PC

		if (!dist[args.KL])
			dist[args.KL] = { total: 0 }

		dist[args.KL][args.ZY] = {
			total: parseInt(total.textContent.trim()) || 0, // 有计划为 0
			name: a.textContent,
			href: a.href,
			note: note.textContent.trim()
		}

		dist[args.KL].total += dist[args.KL][args.ZY].total

		sum += dist[args.KL][args.ZY].total
	}, dist)

	if (dist[pc].total != sum) {
		echo(dist)
		error('plan(' + dist[pc].total + ') and total(' + sum + ') values are not equal. ' +
			doc.location.href)
	}
}

function fixHrefToMarkDown(elm) {
	elm.querySelectorAll('a').forEach(function(a) {
		a.textContent = `[${a.textContent}](${a.href})`
	})
}

function must(parent, selector) {
	let elm = parent.querySelector(selector);
	if (elm) return elm
	error('undefined ' + selector)
}

function mustNextElementSibling(left, clas, url) {
	let right = left.nextElementSibling;
	if (right && right.classList.contains(clas)) return right
	// echo(left.parentElement.innerHTML)
	error(`undefined class ${clas}: ${url}`)
}

function fetchBase(doc, dist) {
	// 解析省市, 批次, 科类代码
	let nl = doc.querySelectorAll('#DDLProvince option');
	dist.provinces = { }
	nl.forEach(function(elm, i) {
		if (i) {
			this[elm.value] = elm.textContent
		}
	}, dist.provinces)

	nl = doc.querySelectorAll('#ddlQuery option');
	dist.PC = { }
	nl.forEach(function(elm, i) {
		if (i) {
			this[elm.value] = elm.textContent
		}
	}, dist.PC)

	nl = doc.querySelectorAll('#ddlKLDM option');
	dist.KL = { }
	nl.forEach(function(elm, i) {
		if (i) {
			this[elm.value] = elm.textContent
		}
	}, dist.KL)
}

function hasNextPage(doc) {
	// 判断是否有下一页
	let elm = doc.querySelector('#PagesUpDown_btnNext')
	if (!elm) return false
	return !elm.hasAttribute('disabled')
}

function fetchNextPagePostData(doc) {
	// 抓取院校列表后续页
	let data = { },
		elms = toArray(doc.querySelector('#frSchoolList').elements)
	elms.forEach(function(elm) {
		this[elm.name] = elm.value
	}, data)
	data.__EVENTTARGET = 'PagesUpDown$btnNext'
	data.__EVENTARGUMENT = ''
	return data
}

function writeFile(file, obj) {
	fs.writeFile(file, JSON.stringify(obj, null, '\t'),
		error)
}

function fetchFirstPageDoc(
	provice, // 省市代号, -1 为全部
	callback // 处理每一页的回调函数
) {
	// 遍历某省院校列表
	let data = {
		DDLProvince: provice,
		ddlQuery: "-",
		ddlKLDM: "-",
		txtyxmc: "",
		txtzymc: "",
		"Imgbtnpro.x": parseInt(Math.random() * 100 % 36 + 1),
		"Imgbtnpro.y": parseInt(Math.random() * 100 % 10 + 1)
	};
	post(paths.SchoolList, data, callback)
}

function walkSchoolsList(
	doc, // 当前的 document
	callback, // 处理每一页的回调函数, 会被首先执行
	done // 全部完成时的回调函数
) {
	next(doc)
	// 遍历院校列表
	function next(doc) {
		callback(doc);
		if (!hasNextPage(doc))
			return done()
		post(paths.SchoolList, fetchNextPagePostData(doc), next)
	}
}

function schoolsCodeHref(doc, cb) {
	// 解析单页的院校列表, 并回调代码和网址
	let nl = doc.querySelectorAll('.SchoolList li a');
	nl.forEach(function(a) {
		let code = a.textContent.slice(1).split(']')[0];
		cb(code, a.href)
	})
}

function toArray(obj) {
	return Array.prototype.slice.call(obj)
}

function echo(obj) {
	console.log(
		typeof obj == 'string' && obj ||
		JSON.stringify(obj, null, '\t')
	)
}

function error(err) {
	if (err) {
		echo(err.message || err)
		process.exit(1);
	}
}
