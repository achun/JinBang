
const fs = require('fs'),
	iconv = require('iconv-lite'),
	charset = require('charset'),
	http = require('http'),
	JSDOM = require('jsdom').JSDOM,
	Buffer = require('buffer').Buffer,
	querystring = require('querystring');

const base = require('./data/base.js'),
	schools = require('./data/schools.js'),
	history = require('./data/history.js'),
	plans = require('./data/plans.js');

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
		// 历史数据查询, 替换三个变量 $year, $kl, $pc
		'2016': 'http://www.heao.gov.cn/datacenter/pages/PZTJFSD.aspx?ddlNF=$year&ddlKL=$kl&ddlPC=$pc'
	};

const cmds = {
	help: function() {
		echo(fs.readFileSync(__dirname + '/usage.txt', 'utf8'))
		process.exit(0)
	},
	valid: function() {
		let ok = true;
		['./data/base.js', './data/schools.js', './data/history.js', './data/plans.js']
			.forEach(function(s) {
				let text = fs.readFileSync(s, 'utf8');
				if (text.indexOf('�') != -1) {
					ok = false
					echo('invalid � : ' + s)
				}
			})
		ok && echo('pass')
	},
	base: function() {
		get(paths.default, function(doc) {
			fetchBase(doc, base)
			writeFile('./data/base.js', base)
		})
	},
	count: function() {
		// 输出统计信息,
		let total = 0,
			duplicate = [],
			codes = Object.keys(base.schools),
			KeysP = Object.keys(base.provinces),
			KeysPC = Object.keys(base.PC),
			KeysKL = Object.keys(base.KL),
			KeysSchools = Object.keys(schools),
			KeysPlans = Object.keys(plans);

		codes.forEach(function(code, i) {
			total += base.schools[code].length
		})

		echo('provinces ' + KeysP.length)
		echo('          ' + KeysP.join(' '))
		if (KeysP.length != codes.length)
			echo('NOT EQUAL ' + codes.length)

		echo('PC        ' + KeysPC.length)
		echo('KL        ' + KeysKL.length)

		echo('schools   ' + total)
		if (KeysSchools.length != total)
			echo('NOT EQUAL ' + total)

		echo('plans     ' + KeysPlans.length)
		if (KeysPlans.length != total)
			echo('NOT EQUAL ' + total)

		total = Object.keys(history.Renamed).length
		if (total) echo('Renamed ' + total)

		total = Object.keys(history.Deprecated).length
		if (total) echo('Deprecated ' + total)
	},
	plans: function(
		...codes // 2 省份代号或 4 位院校代号, 缺省为全部院校
	) {

		let hrefs = [];
		base.schools = base.schools || { }

		if (!codes.length) {
			codes = Object.keys(base.provinces);
			list()
		} else if (codes[0].length == 2) {
			codes.forEach(function(code) {
				if (!base.provinces[code])
					error('undefined province ' + code)
			})
			list()
		} else if (codes[0].length == 4) {
			codes.forEach(function(code) {
				if (code.length != 4)
					error('invalid YXDH ' + code)
				hrefs.push(paths.PCList + '?YXDH=' + code)
			})
			step()
		} else {
			cmds.help()
		}

		function step() {
			if (!hrefs.length) {
				writeFile('./data/base.js', base)
				writeFile('./data/schools.js', schools)
				writeFile('./data/plans.js', plans)
				echo('done')
				return
			}

			get(hrefs.shift(), function(doc) {
				fetchPlans(doc, step)
			})
		}

		// 按照省份抓取院校列表
		function list() {
			let dist,
				province = codes.shift()
			if (!province) {
				step()
				return
			}

			dist = base.schools[province] = []
			walkSchoolsList(province, function(doc) {
				schoolsCodeHref(doc, function(code, href) {
					hrefs.push(href)
					dist.push(code)
				})
			}, list)
		}
	},
	history: function() {
		// 抓取上年历史平行投档分数线
		let year = Date.prototype.getFullYear.call(new Date()) - 1,
			url = (paths[year] || paths['2016']).replace('$year', year),
			kl = ['文科', '理科'],
			pc = ['本科第一批', '本科第二批', '本科第三批', '高职高专批'],
			hrefs = [];

		kl.forEach(function(s, i) {
			s = url.replace('$kl', bufToQuery(iconv.encode(s, 'gbk')))
			pc.forEach(function(v) {
				hrefs.push(i)
				hrefs.push(s.replace('$pc', bufToQuery(iconv.encode(v, 'gbk'))))
			})
		})

		if (base.KL['1'] != '文科综合' || base.KL['5'] != '理科综合')
			error('Need to update history, base.KL is changed')

		history['1'] = []
		history['5'] = []
		history.Deprecated = { }
		history.Renamed = { }
		step()
		function step() {
			let KL = hrefs.shift(),
				total;
			if (!hrefs.length) {
				writeFile('./data/history.js', history)

				total = Object.keys(history.Renamed).length
				if (total) echo('Renamed ' + total)

				total = Object.keys(history.Deprecated).length
				if (total) echo('Deprecated ' + total)

				echo('done')
				return
			}
			KL = KL && '5' || '1'
			get(hrefs.shift(), function(doc) {
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
							row.push(i <= 1 && text || parseInt(text) || 0)
						})

						if (!row.length || !row[0]) return

						if (!schools[row[0]]) {
							history.Deprecated[row[0]] = row[1]
							return
						}

						if (schools[row[0]]['院校名称'] != row[1]) {
							history.Renamed[row[0]] = {
								old: row[1],
								now: schools[row[0]]['院校名称']
							}
						}

						// 院校代号,计划,实际投档人数,投档最低分
						history[KL].push([row[0], row[2], row[3], row[4]])
					}
				)
				if (!keys.length)
					error('Need to update history')
				step()
			})
		}
	}
}

main()

function main() {

	let args = process.argv.slice(2),
		cmd = cmds[args.shift() || 'help'] || cmds.help;
	cmd.apply(null, args)
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
	echo(url)
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

	echo('post: ' + url)
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

function fetchPlans(doc, done) {
	// 抓取院校基本信息和录取计划
	let elm = must(doc, 'td.yxdhtd'),
		code = elm.textContent.trim(),
		dist = schools[code] = schools[code] || { },
		url = doc.location.href;

	dist['院校代号'] = code;
	dist['院校名称'] = must(doc, 'td.yxmctd').textContent.trim();
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
	// 解析省份, 批次, 科类代码
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
	fs.writeFile(file,
		'module.exports = ' + JSON.stringify(obj, null, '\t'),
		error)
}

function walkSchoolsList(
	provice, // 省份代号
	callback, // 处理每一页的回调函数
	done // 全部完成时的回调函数
) {
	// 遍历某省院校列表
	let data = {
		DDLProvince: provice,
		ddlQuery: "",
		ddlKLDM: "",
		txtyxmc: "",
		txtzymc: "",
		"Imgbtnpro.x": parseInt(Math.random() * 100 % 36 + 1),
		"Imgbtnpro.y": parseInt(Math.random() * 100 % 10 + 1)
	};
	// 第一页的 POST 数据是特别的
	post(paths.SchoolList, data, function(doc) {
		callback(doc);
		if (hasNextPage(doc)) next(doc);
		else done()
	})

	function next(doc) {
		post(paths.SchoolList, fetchNextPagePostData(doc), function(doc) {
			callback(doc);
			if (hasNextPage(doc)) next(doc);
			else done()
		})
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
