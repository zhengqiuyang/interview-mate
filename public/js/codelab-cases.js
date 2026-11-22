/* 交互式代码演练场：预置题模板、多语言断言测试集与语言推断（纯 ES Module，零 DOM 依赖） */

const j = (...lines) => lines.join('\n');

const JS_HARNESS_FOOT = j(
  '  console.log("SUMMARY: " + _p + "/" + (_p + _f) + " PASSED");',
  '  if (_f > 0) throw new Error(_f + " 个测试用例未通过");',
  '})();'
);

function jsWrap(casesBody) {
  return j(
    ';(function __runTests() {',
    '  let _p = 0, _f = 0;',
    '  function _case(name, fn) {',
    '    try {',
    '      fn();',
    '      _p++;',
    '      console.log("✓ " + name);',
    '    } catch (e) {',
    '      _f++;',
    '      console.log("✗ " + name + " -> " + (e && e.message ? e.message : e));',
    '    }',
    '  }',
    '  function _eq(a, b, msg) {',
    '    const sa = JSON.stringify(a), sb = JSON.stringify(b);',
    '    if (sa !== sb) throw new Error((msg || "断言失败") + ": got " + sa + ", expect " + sb);',
    '  }',
    casesBody,
    JS_HARNESS_FOOT
  );
}

function pyWrap(casesBody) {
  return j(
    'import sys as _sys, json as _json',
    'def __run_tests():',
    '    _p, _f = 0, 0',
    '    def _case(name, fn):',
    '        nonlocal _p, _f',
    '        try:',
    '            fn()',
    '            _p += 1',
    '            print(f"✓ {name}")',
    '        except Exception as e:',
    '            _f += 1',
    '            print(f"✗ {name} -> {e}")',
    casesBody,
    '    print(f"SUMMARY: {_p}/{_p + _f} PASSED")',
    '    if _f > 0:',
    '        _sys.exit(1)',
    '__run_tests()'
  );
}

function cppWrap(includes, casesBody) {
  return j(
    '#include <iostream>',
    '#include <stdexcept>',
    includes,
    'int main() {',
    '    int _p = 0, _f = 0;',
    '    auto _case = [&](const char* name, auto fn) {',
    '        try {',
    '            fn();',
    '            ++_p;',
    '            std::cout << "✓ " << name << "\\n";',
    '        } catch (const std::exception& e) {',
    '            ++_f;',
    '            std::cout << "✗ " << name << " -> " << e.what() << "\\n";',
    '        }',
    '    };',
    casesBody,
    '    std::cout << "SUMMARY: " << _p << "/" << (_p + _f) << " PASSED\\n";',
    '    return _f > 0 ? 1 : 0;',
    '}'
  );
}

export const CODELAB_CASES = {
  'code-1': {
    title: 'LRU 缓存（get/put O(1)）',
    javascript: {
      starter: j(
        'class LRUCache {',
        '  constructor(capacity) {',
        '    this.cap = capacity;',
        '    this.map = new Map();',
        '  }',
        '  get(key) {',
        '    // TODO: 存在则刷新到最新位置并返回值，否则返回 -1',
        '    return -1;',
        '  }',
        '  put(key, value) {',
        '    // TODO: 插入或更新；超出容量时淘汰最久未使用键',
        '  }',
        '}'
      ),
      harness: jsWrap(j(
        '  _case("基础 get/put 与容量淘汰顺序", () => {',
        '    const c = new LRUCache(2);',
        '    c.put(1, 1); c.put(2, 2);',
        '    _eq(c.get(1), 1, "get(1)");',
        '    c.put(3, 3);',
        '    _eq(c.get(2), -1, "key 2 应被淘汰");',
        '    c.put(4, 4);',
        '    _eq(c.get(1), -1, "key 1 应被淘汰");',
        '    _eq(c.get(3), 3, "get(3)");',
        '    _eq(c.get(4), 4, "get(4)");',
        '  });',
        '  _case("更新已存在 key 时刷新活跃度且不误删", () => {',
        '    const c = new LRUCache(2);',
        '    c.put(2, 1); c.put(2, 2);',
        '    _eq(c.get(2), 2);',
        '    c.put(1, 1); c.put(4, 1);',
        '    _eq(c.get(2), -1, "淘汰最久未用 key 2");',
        '    _eq(c.get(1), 1, "保留 key 1");',
        '  });',
        '  _case("capacity=1 边界", () => {',
        '    const c = new LRUCache(1);',
        '    c.put(10, 100); _eq(c.get(10), 100);',
        '    c.put(20, 200); _eq(c.get(10), -1); _eq(c.get(20), 200);',
        '  });'
      )),
    },
    python: {
      starter: j(
        'from collections import OrderedDict',
        '',
        'class LRUCache:',
        '    def __init__(self, capacity: int):',
        '        self.cap = capacity',
        '        self.cache = OrderedDict()',
        '',
        '    def get(self, key: int) -> int:',
        '        # TODO: 若命中则 move_to_end 并返回值，否则 -1',
        '        return -1',
        '',
        '    def put(self, key: int, value: int) -> None:',
        '        # TODO: 更新或插入；超容量 popitem(last=False)',
        '        pass'
      ),
      harness: pyWrap(j(
        '    def t1():',
        '        c = LRUCache(2)',
        '        c.put(1, 1); c.put(2, 2)',
        '        assert c.get(1) == 1',
        '        c.put(3, 3)',
        '        assert c.get(2) == -1',
        '        c.put(4, 4)',
        '        assert c.get(1) == -1 and c.get(3) == 3 and c.get(4) == 4',
        '    def t2():',
        '        c = LRUCache(1)',
        '        c.put(1, 10); assert c.get(1) == 10',
        '        c.put(2, 20); assert c.get(1) == -1 and c.get(2) == 20',
        '    _case("基础淘汰策略", t1)',
        '    _case("capacity=1 边界", t2)'
      )),
    },
    cpp: {
      starter: j(
        '#include <iostream>',
        '#include <list>',
        '#include <stdexcept>',
        '#include <unordered_map>',
        '#include <utility>',
        '',
        'class LRUCache {',
        'public:',
        '    explicit LRUCache(int capacity) : cap_(capacity) {}',
        '    int get(int key) {',
        '        // TODO: 查找并用 splice O(1) 移至链表头',
        '        return -1;',
        '    }',
        '    void put(int key, int value) {',
        '        // TODO: 更新/插入并在超容时 pop_back()',
        '    }',
        'private:',
        '    int cap_;',
        '    std::list<std::pair<int, int>> lst_;',
        '    std::unordered_map<int, decltype(lst_)::iterator> mp_;',
        '};'
      ),
      harness: cppWrap('', j(
        '    _case("基础 get/put 与淘汰", []() {',
        '        LRUCache c(2);',
        '        c.put(1, 1); c.put(2, 2);',
        '        if (c.get(1) != 1) throw std::runtime_error("get(1) != 1");',
        '        c.put(3, 3);',
        '        if (c.get(2) != -1) throw std::runtime_error("key 2 not evicted");',
        '        c.put(4, 4);',
        '        if (c.get(1) != -1 || c.get(3) != 3 || c.get(4) != 4) throw std::runtime_error("evict mismatch");',
        '    });'
      )),
    },
  },

  'code-2': {
    title: '快速排序（quickSort）',
    javascript: {
      starter: j(
        'function quickSort(nums) {',
        '  // TODO: 原地或返回升序排列的新数组',
        '  return nums;',
        '}'
      ),
      harness: jsWrap(j(
        '  _case("乱序含重复与负数", () => {',
        '    _eq(quickSort([5, 1, 1, 2, 0, -3, 9, 2]), [-3, 0, 1, 1, 2, 2, 5, 9]);',
        '  });',
        '  _case("已排序与逆序大数组", () => {',
        '    _eq(quickSort([1, 2, 3, 4, 5]), [1, 2, 3, 4, 5]);',
        '    _eq(quickSort([9, 7, 5, 3, 1]), [1, 3, 5, 7, 9]);',
        '  });',
        '  _case("空数组与单元素", () => {',
        '    _eq(quickSort([]), []);',
        '    _eq(quickSort([42]), [42]);',
        '  });'
      )),
    },
    python: {
      starter: j(
        'def quick_sort(nums: list[int]) -> list[int]:',
        '    # TODO: 实现快速排序（返回排好序的 list）',
        '    return nums'
      ),
      harness: pyWrap(j(
        '    def t1():',
        '        assert quick_sort([3, 1, 4, 1, 5, -2]) == [-2, 1, 1, 3, 4, 5]',
        '        assert quick_sort([]) == [] and quick_sort([7]) == [7]',
        '    _case("快排基础与边界", t1)'
      )),
    },
  },

  'code-3': {
    title: '二分查找及左/右边界（searchRange）',
    javascript: {
      starter: j(
        '// 返回 target 在升序数组 nums 中 [左边界, 右边界]，不存在返回 [-1, -1]',
        'function searchRange(nums, target) {',
        '  // TODO: 实现 lower_bound 与 upper_bound',
        '  return [-1, -1];',
        '}'
      ),
      harness: jsWrap(j(
        '  _case("多次命中区间", () => _eq(searchRange([5, 7, 7, 8, 8, 10], 8), [3, 4]));',
        '  _case("不存在的目标值", () => _eq(searchRange([5, 7, 7, 8, 8, 10], 6), [-1, -1]));',
        '  _case("全等数组与空数组", () => {',
        '    _eq(searchRange([2, 2, 2], 2), [0, 2]);',
        '    _eq(searchRange([], 1), [-1, -1]);',
        '  });'
      )),
    },
    python: {
      starter: j(
        'def search_range(nums: list[int], target: int) -> list[int]:',
        '    # TODO: 返回 [左边界, 右边界]，不存在返回 [-1, -1]',
        '    return [-1, -1]'
      ),
      harness: pyWrap(j(
        '    def t1():',
        '        assert search_range([5, 7, 7, 8, 8, 10], 8) == [3, 4]',
        '        assert search_range([5, 7, 7, 8, 8, 10], 6) == [-1, -1]',
        '        assert search_range([], 0) == [-1, -1]',
        '    _case("二分左右边界", t1)'
      )),
    },
  },

  'code-4': {
    title: '反转链表（reverseList）',
    javascript: {
      starter: j(
        '// 节点结构: { val, next }',
        'function reverseList(head) {',
        '  // TODO: 原地反转链表并返回新头节点',
        '  return head;',
        '}'
      ),
      harness: jsWrap(j(
        '  const mk = (a) => a.reduceRight((next, val) => ({ val, next }), null);',
        '  const toArr = (h) => { const r = []; while (h) { r.push(h.val); h = h.next; } return r; };',
        '  _case("多节点反转", () => _eq(toArr(reverseList(mk([1, 2, 3, 4, 5]))), [5, 4, 3, 2, 1]));',
        '  _case("单节点与空链表", () => {',
        '    _eq(toArr(reverseList(mk([9]))), [9]);',
        '    _eq(reverseList(null), null);',
        '  });'
      )),
    },
  },

  'code-5': {
    title: '三数之和（threeSum）',
    javascript: {
      starter: j(
        'function threeSum(nums) {',
        '  // TODO: 返回所有不重复的三元组（每个三元组及结果顺序任意）',
        '  return [];',
        '}'
      ),
      harness: jsWrap(j(
        '  const norm = (res) => res.map((x) => [...x].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);',
        '  _case("经典去重用例", () => _eq(norm(threeSum([-1, 0, 1, 2, -1, -4])), [[-1, -1, 2], [-1, 0, 1]]));',
        '  _case("全零去重与无解", () => {',
        '    _eq(norm(threeSum([0, 0, 0, 0])), [[0, 0, 0]]);',
        '    _eq(threeSum([1, 2, 3]), []);',
        '  });'
      )),
    },
  },

  'code-6': {
    title: '有效的括号（isValid）',
    javascript: {
      starter: j(
        'function isValid(s) {',
        '  // TODO: 判断仅包含 ()[]{} 的字符串是否合法闭合',
        '  return false;',
        '}'
      ),
      harness: jsWrap(j(
        '  _case("合法嵌套与并列", () => {',
        '    _eq(isValid("()[]{}"), true);',
        '    _eq(isValid("{[()]}"), true);',
        '  });',
        '  _case("错配、孤立右括号与未闭合", () => {',
        '    _eq(isValid("(]"), false);',
        '    _eq(isValid("([)]"), false);',
        '    _eq(isValid("]"), false);',
        '    _eq(isValid("("), false);',
        '  });'
      )),
    },
    python: {
      starter: j(
        'def is_valid(s: str) -> bool:',
        '    # TODO: 栈匹配括号',
        '    return False'
      ),
      harness: pyWrap(j(
        '    def t1():',
        '        assert is_valid("()[]{}") is True',
        '        assert is_valid("{[()]}") is True',
        '        assert is_valid("([)]") is False',
        '        assert is_valid("]") is False',
        '    _case("括号匹配", t1)'
      )),
    },
  },

  'code-9': {
    title: '归并排序（mergeSort）',
    javascript: {
      starter: j(
        'function mergeSort(nums) {',
        '  // TODO: 分治 + 有序合并，返回升序数组',
        '  return nums;',
        '}'
      ),
      harness: jsWrap(j(
        '  _case("乱序与负数", () => _eq(mergeSort([8, 4, 5, 7, 1, 3, 6, 2, -1]), [-1, 1, 2, 3, 4, 5, 6, 7, 8]));',
        '  _case("重复与空输入", () => {',
        '    _eq(mergeSort([2, 2, 1, 2]), [1, 2, 2, 2]);',
        '    _eq(mergeSort([]), []);',
        '  });'
      )),
    },
  },

  'code-10': {
    title: '合并区间（merge）',
    javascript: {
      starter: j(
        'function merge(intervals) {',
        '  // TODO: 按起点排序后合并重叠区间',
        '  return intervals;',
        '}'
      ),
      harness: jsWrap(j(
        '  _case("部分重叠与完全包含", () => {',
        '    _eq(merge([[1, 3], [2, 6], [8, 10], [15, 18]]), [[1, 6], [8, 10], [15, 18]]);',
        '    _eq(merge([[1, 4], [2, 3]]), [[1, 4]]);',
        '  });',
        '  _case("端点相接与乱序", () => {',
        '    _eq(merge([[4, 5], [1, 4]]), [[1, 5]]);',
        '  });'
      )),
    },
  },

  'code-13': {
    title: 'C++ 手写 SharedPtr 智能指针',
    cpp: {
      starter: j(
        '#include <atomic>',
        '#include <iostream>',
        '#include <stdexcept>',
        '#include <utility>',
        '',
        'template <typename T>',
        'class SharedPtr {',
        'public:',
        '    constexpr SharedPtr() noexcept = default;',
        '    explicit SharedPtr(T* ptr)',
        '        : ptr_(ptr), cnt_(ptr ? new std::atomic<size_t>(1) : nullptr) {}',
        '    ~SharedPtr() { release(); }',
        '    SharedPtr(const SharedPtr& other) noexcept : ptr_(other.ptr_), cnt_(other.cnt_) {',
        '        if (cnt_) cnt_->fetch_add(1, std::memory_order_relaxed);',
        '    }',
        '    SharedPtr(SharedPtr&& other) noexcept',
        '        : ptr_(std::exchange(other.ptr_, nullptr)),',
        '          cnt_(std::exchange(other.cnt_, nullptr)) {}',
        '    SharedPtr& operator=(SharedPtr rhs) noexcept {',
        '        swap(rhs);',
        '        return *this;',
        '    }',
        '    void swap(SharedPtr& o) noexcept { std::swap(ptr_, o.ptr_); std::swap(cnt_, o.cnt_); }',
        '    T* get() const noexcept { return ptr_; }',
        '    size_t use_count() const noexcept { return cnt_ ? cnt_->load() : 0; }',
        'private:',
        '    void release() noexcept {',
        '        if (cnt_ && cnt_->fetch_sub(1, std::memory_order_acq_rel) == 1) {',
        '            delete ptr_; delete cnt_;',
        '        }',
        '        ptr_ = nullptr; cnt_ = nullptr;',
        '    }',
        '    T* ptr_ = nullptr;',
        '    std::atomic<size_t>* cnt_ = nullptr;',
        '};'
      ),
      harness: cppWrap('', j(
        '    _case("拷贝递增计数、移动归零源、作用域归零析构", []() {',
        '        struct Tracker { int* n; ~Tracker() { ++(*n); } };',
        '        int destroyed = 0;',
        '        {',
        '            SharedPtr<Tracker> p1(new Tracker{&destroyed});',
        '            if (p1.use_count() != 1) throw std::runtime_error("use_count != 1");',
        '            SharedPtr<Tracker> p2 = p1;',
        '            if (p1.use_count() != 2 || p2.use_count() != 2) throw std::runtime_error("copy count != 2");',
        '            SharedPtr<Tracker> p3 = std::move(p2);',
        '            if (p2.get() != nullptr || p3.use_count() != 2) throw std::runtime_error("move failed");',
        '        }',
        '        if (destroyed != 1) throw std::runtime_error("object not destroyed exactly once");',
        '    });'
      )),
    },
  },

  'code-14': {
    title: 'C++ 手写有界阻塞队列',
    cpp: {
      starter: j(
        '#include <condition_variable>',
        '#include <deque>',
        '#include <iostream>',
        '#include <mutex>',
        '#include <optional>',
        '#include <stdexcept>',
        '#include <thread>',
        '',
        'template <typename T>',
        'class BoundedBlockingQueue {',
        'public:',
        '    explicit BoundedBlockingQueue(size_t cap) : cap_(cap) {}',
        '    bool push(T item) {',
        '        std::unique_lock<std::mutex> lk(mu_);',
        '        not_full_.wait(lk, [&] { return closed_ || q_.size() < cap_; });',
        '        if (closed_) return false;',
        '        q_.push_back(std::move(item));',
        '        lk.unlock();',
        '        not_empty_.notify_one();',
        '        return true;',
        '    }',
        '    std::optional<T> pop() {',
        '        std::unique_lock<std::mutex> lk(mu_);',
        '        not_empty_.wait(lk, [&] { return closed_ || !q_.empty(); });',
        '        if (q_.empty()) return std::nullopt;',
        '        T v = std::move(q_.front()); q_.pop_front();',
        '        lk.unlock();',
        '        not_full_.notify_one();',
        '        return v;',
        '    }',
        '    void close() {',
        '        { std::lock_guard<std::mutex> lk(mu_); closed_ = true; }',
        '        not_full_.notify_all(); not_empty_.notify_all();',
        '    }',
        'private:',
        '    size_t cap_;',
        '    std::mutex mu_;',
        '    std::condition_variable not_full_, not_empty_;',
        '    std::deque<T> q_;',
        '    bool closed_ = false;',
        '};'
      ),
      harness: cppWrap('', j(
        '    _case("多生产者多消费者无丢包与优雅退出", []() {',
        '        BoundedBlockingQueue<int> q(4);',
        '        std::thread prod([&] { for (int i = 1; i <= 50; ++i) q.push(i); q.close(); });',
        '        long long sum = 0;',
        '        std::thread cons([&] { while (auto v = q.pop()) sum += *v; });',
        '        prod.join(); cons.join();',
        '        if (sum != 1275) throw std::runtime_error("sum mismatch");',
        '    });'
      )),
    },
  },

  'code-15': {
    title: 'C++ 五法则 MyString',
    cpp: {
      starter: j(
        '#include <algorithm>',
        '#include <cstring>',
        '#include <iostream>',
        '#include <stdexcept>',
        '#include <string>',
        '#include <utility>',
        '',
        'class MyString {',
        'public:',
        '    MyString(const char* s = "") {',
        '        size_ = s ? std::strlen(s) : 0;',
        '        data_ = new char[size_ + 1];',
        '        if (size_) std::memcpy(data_, s, size_);',
        '        data_[size_] = \'\\0\';',
        '    }',
        '    ~MyString() { delete[] data_; }',
        '    MyString(const MyString& o) : size_(o.size_) {',
        '        data_ = new char[size_ + 1];',
        '        std::memcpy(data_, o.data_, size_ + 1);',
        '    }',
        '    MyString(MyString&& o) noexcept',
        '        : data_(std::exchange(o.data_, new char[1]{\'\\0\'})),',
        '          size_(std::exchange(o.size_, 0)) {}',
        '    MyString& operator=(MyString rhs) noexcept { swap(rhs); return *this; }',
        '    void swap(MyString& o) noexcept { std::swap(data_, o.data_); std::swap(size_, o.size_); }',
        '    const char* c_str() const noexcept { return data_; }',
        '    size_t size() const noexcept { return size_; }',
        'private:',
        '    char* data_ = nullptr;',
        '    size_t size_ = 0;',
        '};'
      ),
      harness: cppWrap('', j(
        '    _case("深拷贝、移动与自赋值", []() {',
        '        MyString a("hello"); MyString b = a;',
        '        b = b;',
        '        if (std::string(b.c_str()) != "hello" || b.c_str() == a.c_str()) throw std::runtime_error("copy/self-assign failed");',
        '        MyString c = std::move(a);',
        '        if (std::string(c.c_str()) != "hello" || a.size() != 0) throw std::runtime_error("move failed");',
        '    });'
      )),
    },
  },

  'code-16': {
    title: 'C++ 原子自旋锁 SpinLock',
    cpp: {
      starter: j(
        '#include <atomic>',
        '#include <iostream>',
        '#include <mutex>',
        '#include <stdexcept>',
        '#include <thread>',
        '',
        'class SpinLock {',
        'public:',
        '    void lock() noexcept {',
        '        while (flag_.test_and_set(std::memory_order_acquire)) {',
        '            std::this_thread::yield();',
        '        }',
        '    }',
        '    void unlock() noexcept {',
        '        flag_.clear(std::memory_order_release);',
        '    }',
        'private:',
        '    std::atomic_flag flag_ = ATOMIC_FLAG_INIT;',
        '};'
      ),
      harness: cppWrap('', j(
        '    _case("多线程互斥临界区计数", []() {',
        '        SpinLock lk;',
        '        int cnt = 0;',
        '        auto work = [&] { for (int i = 0; i < 10000; ++i) { std::lock_guard<SpinLock> g(lk); ++cnt; } };',
        '        std::thread t1(work), t2(work);',
        '        t1.join(); t2.join();',
        '        if (cnt != 20000) throw std::runtime_error("race detected");',
        '    });'
      )),
    },
  },

  'code-18': {
    title: '数值稳定 Softmax + Cross-Entropy',
    python: {
      starter: j(
        'import math',
        '',
        'def softmax_cross_entropy(logits: list[list[float]], targets: list[int]):',
        '    """',
        '    不依赖第三方库的纯 Python 测试接口：',
        '    返回 (平均标量 loss, 梯度二维列表 grad)',
        '    """',
        '    n = len(logits)',
        '    # TODO: 减去行 max 防 exp 溢出；计算平均 loss 与 (probs - one_hot) / n 梯度',
        '    raise NotImplementedError("请实现 softmax_cross_entropy")'
      ),
      harness: pyWrap(j(
        '    def t1():',
        '        loss, grad = softmax_cross_entropy([[1000.0, 1001.0], [1002.0, 1000.0]], [1, 0])',
        '        assert not (loss != loss) and loss < 1.0, f"数值稳定性失效: {loss}"',
        '        assert abs(sum(grad[0])) < 1e-6 and grad[0][1] < 0 and grad[0][0] > 0',
        '    _case("超大 logits 平移不溢出与梯度和为 0", t1)'
      )),
    },
    javascript: {
      starter: j(
        'function softmaxCrossEntropy(logits, targets) {',
        '  // TODO: 对每行减最大值防溢出，返回 { loss, grad }',
        '  return { loss: 0, grad: [] };',
        '}'
      ),
      harness: jsWrap(j(
        '  _case("超大 logits 防溢出与梯度正确性", () => {',
        '    const { loss, grad } = softmaxCrossEntropy([[1000, 1001], [1002, 1000]], [1, 0]);',
        '    if (!Number.isFinite(loss) || loss <= 0 || loss >= 1) throw new Error("unexpected loss: " + loss);',
        '    if (Math.abs(grad[0][0] + grad[0][1]) > 1e-9) throw new Error("row grad sum != 0");',
        '    if (!(grad[0][1] < 0 && grad[0][0] > 0)) throw new Error("grad sign wrong");',
        '  });'
      )),
    },
  },

  'code-21': {
    title: '柱状图中最大的矩形（单调栈）',
    javascript: {
      starter: j(
        'function largestRectangleArea(heights) {',
        '  // TODO: 单调递增栈 + 首尾哨兵 0，O(N) 求解最大面积',
        '  return 0;',
        '}'
      ),
      harness: jsWrap(j(
        '  _case("典型高低柱子", () => _eq(largestRectangleArea([2, 1, 5, 6, 2, 3]), 10));',
        '  _case("单调递增与单柱边界", () => {',
        '    _eq(largestRectangleArea([2, 4]), 4);',
        '    _eq(largestRectangleArea([0, 9]), 9);',
        '  });'
      )),
    },
    cpp: {
      starter: j(
        '#include <algorithm>',
        '#include <iostream>',
        '#include <stack>',
        '#include <stdexcept>',
        '#include <vector>',
        '',
        'int largestRectangleArea(std::vector<int>& heights) {',
        '    // TODO: 首尾补 0 + 单调栈 O(N) 计算最大矩形面积',
        '    return 0;',
        '}'
      ),
      harness: cppWrap('', j(
        '    _case("经典柱状图用例", []() {',
        '        std::vector<int> a{2, 1, 5, 6, 2, 3};',
        '        if (largestRectangleArea(a) != 10) throw std::runtime_error("expect 10");',
        '        std::vector<int> b{2, 4};',
        '        if (largestRectangleArea(b) != 4) throw std::runtime_error("expect 4");',
        '    });'
      )),
    },
  },

  'code-22': {
    title: '堆优化 Dijkstra 最短路径',
    javascript: {
      starter: j(
        '// n 个点 (0..n-1)，edges: [u, v, w] 有向非负边，返回 src 到各点最短距（不可达为 -1）',
        'function shortestPaths(n, edges, src) {',
        '  // TODO: 邻接表 + 优先队列（或小顶堆）实现 Dijkstra',
        '  return new Array(n).fill(-1);',
        '}'
      ),
      harness: jsWrap(j(
        '  _case("带多路径与不可达点图", () => {',
        '    _eq(shortestPaths(4, [[0,1,4],[0,2,1],[2,1,2],[1,3,1],[2,3,5]], 0), [0, 3, 1, 4]);',
        '    _eq(shortestPaths(3, [[0,1,2]], 0), [0, 2, -1]);',
        '  });'
      )),
    },
    cpp: {
      starter: j(
        '#include <iostream>',
        '#include <limits>',
        '#include <queue>',
        '#include <stdexcept>',
        '#include <utility>',
        '#include <vector>',
        '',
        'struct Edge { int to; long long w; };',
        '',
        'std::vector<long long> dijkstra(int n, int src, const std::vector<std::vector<Edge>>& adj) {',
        '    // TODO: 小根堆实现 Dijkstra，注意 if (d > dist[u]) continue',
        '    return std::vector<long long>(n, -1);',
        '}'
      ),
      harness: cppWrap('', j(
        '    _case("松弛抄近路验证", []() {',
        '        std::vector<std::vector<Edge>> adj(4);',
        '        adj[0].push_back({1, 4}); adj[0].push_back({2, 1});',
        '        adj[2].push_back({1, 2}); adj[1].push_back({3, 1});',
        '        auto d = dijkstra(4, 0, adj);',
        '        if (d[0] != 0 || d[1] != 3 || d[2] != 1 || d[3] != 4) throw std::runtime_error("dist error");',
        '    });'
      )),
    },
  },

  'code-23': {
    title: '并查集 Union-Find',
    javascript: {
      starter: j(
        'class UnionFind {',
        '  constructor(n) {',
        '    this.parent = Array.from({ length: n }, (_, i) => i);',
        '    this.count = n;',
        '  }',
        '  find(x) { /* TODO */ return x; }',
        '  unite(a, b) { /* TODO: 若本已连通返回 false，否则合并并返回 true */ return false; }',
        '  connected(a, b) { return this.find(a) === this.find(b); }',
        '  components() { return this.count; }',
        '}'
      ),
      harness: jsWrap(j(
        '  _case("连通合并、判环与连通分量数", () => {',
        '    const uf = new UnionFind(4);',
        '    _eq(uf.unite(0, 1), true);',
        '    _eq(uf.unite(1, 2), true);',
        '    _eq(uf.connected(0, 2), true);',
        '    _eq(uf.unite(0, 2), false, "成环合并应返回 false");',
        '    _eq(uf.components(), 2);',
        '  });'
      )),
    },
    cpp: {
      starter: j(
        '#include <iostream>',
        '#include <numeric>',
        '#include <stdexcept>',
        '#include <utility>',
        '#include <vector>',
        '',
        'class UnionFind {',
        'public:',
        '    explicit UnionFind(int n) : p_(n), sz_(n, 1), cnt_(n) { std::iota(p_.begin(), p_.end(), 0); }',
        '    int find(int x) { /* TODO */ return x; }',
        '    bool unite(int a, int b) { /* TODO */ return false; }',
        '    bool connected(int a, int b) { return find(a) == find(b); }',
        '    int components() const noexcept { return cnt_; }',
        'private:',
        '    std::vector<int> p_, sz_; int cnt_;',
        '};'
      ),
      harness: cppWrap('', j(
        '    _case("路径压缩与连通块计数", []() {',
        '        UnionFind uf(4);',
        '        if (!uf.unite(0, 1) || !uf.unite(1, 2) || uf.unite(0, 2)) throw std::runtime_error("unite failed");',
        '        if (!uf.connected(0, 2) || uf.components() != 2) throw std::runtime_error("components error");',
        '    });'
      )),
    },
  },

  'code-25': {
    title: '最小覆盖子串（minWindow）',
    javascript: {
      starter: j(
        'function minWindow(s, t) {',
        '  // TODO: 滑动窗口 + valid 种类数 O(|S|+|T|)',
        '  return "";',
        '}'
      ),
      harness: jsWrap(j(
        '  _case("经典覆盖子串", () => _eq(minWindow("ADOBECODEBANC", "ABC"), "BANC"));',
        '  _case("完全匹配与无解", () => {',
        '    _eq(minWindow("a", "a"), "a");',
        '    _eq(minWindow("a", "aa"), "");',
        '  });'
      )),
    },
    python: {
      starter: j(
        'def min_window(s: str, t: str) -> str:',
        '    # TODO: 滑动窗口寻找最短覆盖 t 所有字符（含重复）的子串',
        '    return ""'
      ),
      harness: pyWrap(j(
        '    def t1():',
        '        assert min_window("ADOBECODEBANC", "ABC") == "BANC"',
        '        assert min_window("a", "aa") == ""',
        '    _case("最小覆盖子串", t1)'
      )),
    },
  },

  'code-26': {
    title: 'O(N log N) 最长递增子序列（lengthOfLIS）',
    javascript: {
      starter: j(
        'function lengthOfLIS(nums) {',
        '  // TODO: 贪心 tails 数组 + 二分查找（严格递增）',
        '  return 0;',
        '}'
      ),
      harness: jsWrap(j(
        '  _case("严格递增序列", () => {',
        '    _eq(lengthOfLIS([10, 9, 2, 5, 3, 7, 101, 18]), 4);',
        '    _eq(lengthOfLIS([0, 1, 0, 3, 2, 3]), 4);',
        '  });',
        '  _case("全部相等严格递增为 1", () => _eq(lengthOfLIS([7, 7, 7, 7]), 1));'
      )),
    },
    python: {
      starter: j(
        'from bisect import bisect_left',
        '',
        'def length_of_lis(nums: list[int]) -> int:',
        '    # TODO: tails + bisect_left',
        '    return 0'
      ),
      harness: pyWrap(j(
        '    def t1():',
        '        assert length_of_lis([10, 9, 2, 5, 3, 7, 101, 18]) == 4',
        '        assert length_of_lis([7, 7, 7]) == 1',
        '    _case("O(N log N) LIS", t1)'
      )),
    },
  },
};

export function extractFenceSnippet(q, lang) {
  if (!q || !q.a) return '';
  const fenceLang = lang === 'javascript' ? '(?:js|javascript)' : lang;
  const re = new RegExp('```' + fenceLang + '\\r?\\n([\\s\\S]*?)```', 'i');
  const m = String(q.a).match(re);
  return m ? m[1].trim() : '';
}

export function defaultLangForQuestion(q, runtimes = { javascript: { ok: true }, python: { ok: false }, cpp: { ok: false }, localExecAllowed: false }) {
  const id = q && q.id;
  const entry = id ? CODELAB_CASES[id] : null;
  const ans = String(q?.a || '');
  const canCpp = Boolean(runtimes?.cpp?.ok && runtimes?.localExecAllowed);
  const canPy = Boolean(runtimes?.python?.ok && runtimes?.localExecAllowed);

  if (/```cpp\b/i.test(ans) && canCpp) return 'cpp';
  if (/```python\b/i.test(ans) && canPy) return 'python';
  if (entry) {
    if (entry.javascript) return 'javascript';
    if (entry.cpp && canCpp) return 'cpp';
    if (entry.python && canPy) return 'python';
    if (entry.cpp) return 'cpp';
    if (entry.python) return 'python';
  }
  return 'javascript';
}

export function getStarter(q, lang) {
  const id = q && q.id;
  const spec = id && CODELAB_CASES[id] && CODELAB_CASES[id][lang];
  if (spec && spec.starter) return spec.starter;

  const title = q?.q ? q.q.slice(0, 60) : '自由编码演练';
  if (lang === 'python') {
    return j(
      `# ${title}`,
      'def solve():',
      '    print("Hello InterviewMate Code Lab!")',
      '',
      'if __name__ == "__main__":',
      '    solve()'
    );
  }
  if (lang === 'cpp') {
    return j(
      `// ${title}`,
      '#include <iostream>',
      '#include <vector>',
      '',
      'int main() {',
      '    std::cout << "Hello InterviewMate Code Lab!" << std::endl;',
      '    return 0;',
      '}'
    );
  }
  return j(
    `// ${title}`,
    'function solve() {',
    '  console.log("Hello InterviewMate Code Lab!");',
    '}',
    'solve();'
  );
}

export function hasTestHarness(qid, lang) {
  return Boolean(qid && CODELAB_CASES[qid] && CODELAB_CASES[qid][lang] && CODELAB_CASES[qid][lang].harness);
}

export function buildRunnableSource(qid, lang, userCode) {
  const spec = qid && CODELAB_CASES[qid] && CODELAB_CASES[qid][lang];
  if (!spec || !spec.harness) return userCode;
  return `${userCode}\n\n${spec.harness}\n`;
}
