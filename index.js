
const fs = require('fs'),
	iconv = require('iconv-lite'),
	charset = require('charset'),
	http = require('http'),
	JSDOM = require('jsdom').JSDOM,
	Buffer = require('buffer').Buffer,
	querystring = require('querystring'),
	common = require('./lib/common'),
	{search, school, hope} = common;


let {base, schools, totals, rank} = common,
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
			hrefs = codes.map(function(code) {
				if (code.length != 4) error('院校代号必须为四位')
				return paths.PCList + '?YXDH=' + code
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
	summary: function() {
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
		// echo('\t' + KeysP.join(' '))

		echo('批次\t' + KeysPC.length)
		echo('科类\t' + KeysKL.length)

		echo('院校\t' + KeysPlans.length + ', 省市 ' + total)



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

		let xian = require('./data/shengkong.json');
		let fen = require('./data/fen.json');
		echo()
		echo(`省控线`)
		someEach(xian, function(o, pc) {
			echo()
			echo(`[${pc}]${base.PC[pc]}`)
			someEach(o, function(v, kl) {
				echo(`	${v}	[${kl}]${base.KL[kl]}`)
				if (fen[kl]) {
					v = search(fen[kl], function(a) {
						return a[0] - v
					})
					this[kl] = fen[kl][v][1]
				}
			}, o)
		})

		if (problem.length) {
			echo('问题:')
			problem.forEach(function(s) {
				echo('\t' + s)
			})
			process.exit(1)
		}

		echoHis(history)

		echo()
		echo('考生省控线分段(非累计)')
		xian['2']['1'] -= xian['1']['1']
		xian['2']['5'] -= xian['1']['5']
		someEach(xian, function(o, pc) {
			echo()
			echo(`[${pc}]${base.PC[pc]}`)
			someEach(o, function(v, kl) {
				echo(`	${v}	[${kl}]${base.KL[kl]}`)
			})
		})

		echoPredict(rank)

		let plan = totals;
		echo()
		echo(`计划	${plan.total}`)

		someEach(plan, function(o, pc) {
			if (pc == 'total' || pc == 'zero') return

			echo()
			echo(`	${o.total}		[${pc}]${base.PC[pc]}`)
			echo()
			someEach(o, function(total, kl) {
				if (kl == 'total') return
				echo(`		${total}	[${kl}]${base.KL[kl]}`)
			})
		})

		echo()
		echo(`零计划院校代号`)
		someEach(plan.zero, function(o, pc) {
			echo()
			echo(`	[${pc}]${base.PC[pc]}`)
			echo()
			someEach(o, function(a, kl) {
				echo(`		[${kl}]${base.KL[kl]}`)
				while (a.length) {
					echo('		' + a.slice(0, 10).join(' '))
					a = a.slice(10)
				}
			})
		})
	},
	total: function() {
		// 分批次, 科类统计招生计划并保存到 data/total.json
		let plan = { total: 0 },
			zero = { };
		someEach(plans, function(o, yxdh) {
			let total = 0;

			someEach(o, function(o, pc) {
				if ('total' == pc) {
					total += o
					return
				}
				if (!this[pc])
					this[pc] = { total: 0 }

				this[pc].total += o.total

				if (o.total == 0) {
					zero[pc] = zero[pc] || { }
					someEach(o, function(o, kl) {
						if ('total' == kl) return

						this[kl] = this[kl] || []

						if (this[kl].indexOf(yxdh) == -1)
							this[kl].push(yxdh)
					}, zero[pc])
				} else {
					someEach(o, function(o, kl) {
						if ('total' == kl) return
						this[kl] = (this[kl] || 0) + o.total
					}, this[pc])
				}

			}, this) // this === plan

			if (total != o.total)
				error(`合计错误: [${yxdh}]院校 ${o.total}/${total}`)
			this.total += total
		}, plan)

		someEach(zero, function(o) {
			someEach(o, function(a) {
				a.sort()
			})
		})

		plan.zero = zero;
		writeFile('./data/total.json', plan)
	},
	history: function() {
		// 抓取上年平行投档分数线到 history.json
		let year = base.year - 1,
			cfg = paths[year] || paths['2016'],
			want = '院校代号,院校名称,计划,实际投档人数,投档最低分',
			tasks = [];
		if (base.PC["1"] != '本科一批' || base.PC["2"] != '本科二批' ||
			base.PC["4"] != '高职高专批' ||
			base.KL["1"] != '文科综合' || base.KL["5"] != '理科综合'
			)
			error('需要更新源码: base 变动')

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
		history.newplan = { }
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
				// 最后调整比例因子
				hisScale(history)
				writeFile('./data/history.json', history)
				echoHis(history)
				echo('done')
				return
			}

			let newplan = { },
				codes = [];// 计算 pc, kl 所有院校, 剔除后就是新增的院校

			history.newplan[PC] = { }
			history.newplan[PC][KL] = newplan;

			someEach(plans, function(o, code) {
				o = o[PC]
				if (o && o[KL] && o[KL].total)
					codes.push(code)
			})

			get(task[2], function(doc) {
				let row,
					keys = [];
				doc.querySelectorAll('tr').forEach(function(tr) {
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

					if (!row.length || !row[0] ||
						!row[4]// 过滤掉无分数的
						) return

					// 往年有计划, 今年无计划
					if (!plans[row[0]] || !plans[row[0]][PC] ||
						!plans[row[0]][PC][KL]) {
						if (!ignore)
							history.planless[row[0]] = row[1]
						return
					}

					// 院校更名
					let name = schools[row[0]]['院校名称'];
					if (name != row[1] && !name.startsWith(row[1]) &&
						!row[1].startsWith(name)) {
						history.renamed[row[0]] = {
							old: row[1],
							now: name
						}
					}
					// 剔除计划的, 就是新增的
					i = codes.indexOf(row[0])
					if (i != -1)
						codes[i] = null

					dist.push([
						row[4], // 分数
						row[0], // 院校代号
						row[2], // 计划人数
						1       // 比例因子, 当同批次多条记录时适用
					])
				})

				if (!keys.length)
					error('需要更新源码: 目标页面结构变化')

				// 按分数排序
				dist.sort(function(a, b) {
					return a[0] < b[0] && 1 || -1
				})
				// 计算新增院校
				codes.forEach(function(c) {
					if (c)
						newplan[c] = plans[c][PC][KL].total
				})
				step()
			})
		}
	},
	plan: function(pc, kl, ...codes) {
		let c = 0,
			url = paths.PCList + '?YXDH='
		// 输出院校招生计划概要
		if (!pc || !base.PC[pc] ||
			!kl || !base.KL[kl] || !codes || !codes.length) {
			echo('必须指定批次, 科类和院校代码')
			echo(base.PC)
			echo(base.KL)
			return
		}

		school(codes, function(s, obj) {
			let o = obj && plans[s] && plans[s][pc] && plans[s][pc][kl];
			if (o) {
				c += o.total
				echo(`${o.total}	[${s}]${obj['院校名称']} ${url}${s}`)
			}
		})
		echo()
		echo(`${c}	[${pc}]${base.PC[pc]} [${kl}]${base.KL[kl]}`)
	},
	rank: predict, // 按科类生成志愿填报排行
	hope: function(
		pc,     // 批次代号
		kl,     // 科类代号
		actual, // 总分
		U,      // 档差上界 0 - 30, 默认 10
		L       // 档差下界 0 - 30, 默认 20
	) {
		// 在 rank[pc][kl] 中查找并返回总分 上 U 档 下 L 档的院校
		// 如果 rank[pc][kl] 不存在返回 null

		let hops = hope(pc, kl, actual, U, L);
		let url = paths.PCList + '?YXDH=';
		if (!hops) error(`未定义的批次代号 ${pc} 或科类代号 ${kl}`);
		hops.forEach(function(a) {
			echo(`${a[0]}	竞争考生 ${a[2]} 优势考生 ${a[3]} 上年投档线 ${a[1]}`)
			a.forEach(function(code, i) {
				if (i < 4) return

				echo(`	${url}${code} ` +
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

function someEach(obj, callback, thisArg) {
	let some;
	for (let k in obj) {
		some = callback.call(thisArg, obj[k], k)
		if (some != null) break
	}
	return some
}

function hisScale(history) {
	// 计算 history[PC][KL][i][3] 比例因子
	// 参数 history 是已经排序的
	//
	// 算法
	//
	//     先统计同一个院校计划招生总是 S, 限本科批次, 分批次, 分科类
	//     然后每条记录所占的比例数就是: 计划招生/S

	someEach(history, function(o, pc) {
		if (pc != '1' && pc != '2') return
		someEach(o, function(a, kl) {
			if (kl != '1' && kl != '5') return
			let codes = { }
			a.forEach(function(a, i) {
				let yx = a[1];
				this[yx] = this[yx] || []
				if (!this[yx].length)
					this[yx].push(a[2])
				else
					this[yx][0] += a[2]
				this[yx].push(i)
			}, codes)

			someEach(codes, function(a) {
				if (a.length == 2) return
				for (let i = 1; i < a.length; i++) {
					this[a[i]][3] = this[a[i]][2] / a[0]
				}
			}, a)
		})
	})
}

function echoHis(history) {
	let total = Object.keys(history.renamed).length
	if (total) echo() || echo('更名	' + total)


	total = Object.keys(history.planless).length
	if (total) echo() || echo('无计划	' + total)

	echo() || echo('新计划')
	someEach(history.newplan, function(o, pc) {
		total = 0
		someEach(o, function(o, kl) {
			someEach(o, function(v, id) {
				total += v
			})
		})
		echo() || echo(`	${total}	[${pc}]${base.PC[pc]}`)
		someEach(o, function(o, kl) {
			total = 0
			someEach(o, function(v, id) {
				total += v
			})
			echo(`		${total}	[${kl}]${base.KL[kl]}`)
			someEach(o, function(v, id) {
				echo(`			${v}	[${id}]${schools[id]['院校名称']}`)
			})
		})
	})
}

function echoPredict(rank) {
	echo()
	echo('预测')
	let prediction = { total: 0 };

	someEach(rank, function(o, pc) {
		this[pc] = { total: 0 }
		someEach(o, function(a, kl) {
			this[kl] = a.reduce(function(hj, a) {
				return hj + a[2]
			}, 0)
			this.total += this[kl]
		}, this[pc])

		this.total += this[pc].total
	}, prediction)

	someEach(prediction, function(o, pc) {
		if (pc == 'total') return
		echo()
		echo(`	${o.total}	[${pc}]${base.PC[pc]}`)
		someEach(o, function(o, kl) {
			if (kl !== 'total')
				echo(`		${o}	[${kl}]${base.KL[kl]}`)
		})
	})

}

function predict() {
	// 投档预测
	// {批次代号: {科别代号:
	//     [[预测投档线,累计考生, 竞争考生, 优势考生, 院校代号...]...]
	// }}
	//
	let fens = require('./data/fen.json'),
		xian = require('./data/shengkong.json'),
		rank = { '1': { '1': [], '5': [] }, '2': { '1': [], '5': [] } };

	if (base.PC["1"] != '本科一批' || base.PC["2"] != '本科二批' ||
		base.KL["1"] != '文科综合' || base.KL["5"] != '理科综合'
		)
		error('需要更新源码: base 变动');

	let i = 0,
		total = 0,
		winner = 0;

	run('1', '1');
	run('2', '1');

	i = 0;
	total = 0;
	winner = 0;
	run('1', '5');
	run('2', '5');

	// echo(rank["1"]["1"][rank["1"]["1"].length - 1])
	// echo(rank["2"]["1"][0])

	// echo(rank["1"]["5"][rank["1"]["5"].length - 1])
	// echo(rank["2"]["5"][0])
	echoPredict(rank)

	writeFile('./data/rank.json', rank)

	function run(pc, kl) {
		let fen = fens[kl],
			min = xian[pc][kl],
			h = 0,
			his = history[pc] && history[pc][kl],
			tops = rank[pc][kl],
			top = [0, 0, 0, 0];

		if (!min) error('数据缺失: 省录取控制分数线')
		if (!his || !fen) error('数据缺失: 历史数据')

		while (h < his.length && i < fen.length && fen[i][0] >= min) {
			let racer = 0,
				v = his[h][0];

			// 投档线相同, 收集到一起
			while (h < his.length && v == his[h][0]) {
				let code = his[h][1],
					o = plans[code];
				o = o && o[pc];
				o = o && o[kl];

				if (o && o.total) {
					racer += his[h][3] * o.total
					top.push(code)
				}
				h++
			}

			// 计划招生
			racer = Math.round(racer)
			total += racer

			// 计划多, 考生少, 投档线降
			if (winner < racer) {
				while (i < fen.length && fen[i][1] < total) {
					i++;
					if (i == fen.length || fen[i][0] < min) {
						i--;
						break
					}
				}
				top[3] = winner
				winner = fen[i][1] - total
			} else {
				// 考生多, 计划少, 投档线升
				i && i--
				let codes = top.slice(4)
				top = tops.pop() || [0, 0, 0, winner]
				codes.forEach(function(c) {
					top.push(c)
				}, top)
				winner = 0
			}

			top[0] = fen[i][0]
			top[1] = v
			top[2] += racer

			tops.push(top)

			top = [0, 0, 0, 0]
			i++
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
	// 非增量抓取, 每次都被清零, 抓取院校基本信息和录取计划
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

	dist = plans[code] = { total: 0 }

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
		if (!href) {
			done()
		} else get(href, function(doc) {
				fetchPCContend(doc, dist)
				run()
			})
	}
}

function queryToObj(href, obj) {
	let key;
	obj = obj || { }
	href.split(/[?=&]/).forEach(function(s, i) {
		if (!i) return
		if (!key) {
			key = s
		} else {
			obj[key] = s
			key = ''
		}
	})
	return obj
}

function fetchPCContend(doc, dist) {
	// 该页面是同一个批次的
	let sum = 0, // 批次计划总数
		url = doc.location.href,
		pc = queryToObj(url).PC;
	if (!pc) error('undefined PC in URL ' + url)
	if (!dist[pc]) error('undefined dist[pc] for URL ' + url)

	toArray(doc.querySelectorAll('td.pcyxdh')).some(function(elm) {
		if (elm.textContent.trim().startsWith('计划总数')) {
			elm = mustNextElementSibling(elm, 'pcyxmctd', url)
			sum = parseInt(elm.textContent.trim()) || 0
			return true
		}
	})

	if (dist[pc].total != sum)
		error(`计划总数不符: 上级页面计划招生人数 ${dist[pc].total} 与内页 ${sum} ${url}`)

	dist[pc].total = 0

	doc.querySelectorAll('td.planListTD:nth-child(1)').forEach(function(elm) {
		let a = must(elm, 'a'),
			cat = mustNextElementSibling(elm, 'tdpcjhrs', url),
			total = mustNextElementSibling(cat, 'tdpcjhrs', url),
			note = mustNextElementSibling(total, 'planListTD', url),
			args = queryToObj(a.href);

		// PC->KL->ZY->{}
		if (!args.PC || !args.KL || !args.ZY ||
			!base.PC[args.PC] || !base.KL[args.KL] ||
			pc != args.PC)
			error('invalid query arguments ' + JSON.stringify(args) + ' of plan ' + url)

		if (!this[args.KL])
			this[args.KL] = { total: 0 }

		let dist = this[args.KL]
		if (dist[args.ZY])
			error(`专业重复: [${args.ZY}] of plan ${url}`)

		dist[args.ZY] = {
			total: parseInt(total.textContent.trim()) || 0, // 有计划为 0
			name: a.textContent,
			href: a.href,
			note: note.textContent.trim()
		}

		dist.total += dist[args.ZY].total
		this.total += dist[args.ZY].total

	}, dist[pc])

	if (dist[pc].total != sum)
		error(`计划总数不符: 计算总数 ${dist[pc].total} 与页面计划总数 ${sum} ${url}`)

	dist.total += sum
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
	if (!arguments.length)
		console.log('')
	else
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
